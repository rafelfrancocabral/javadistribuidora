// ============================================================
// Java Distribuidora - Painel administrativo
// ============================================================
const AUTH_KEY = 'jv2_admin_auth';
const WHATSAPP_NUMBER = '5512997780047';

let products = [];
let categories = [];
let quotes = [];
let pendingUploads = [];
let clients = [];
let currentChartPeriod = 'today';
let chartQuotesInstance = null;
let chartPaymentsInstance = null;

const STATUS_FLOW = ['recebido', 'analise', 'aprovado', 'concluido', 'cancelado'];
const STATUS_NEXT = { recebido: 'analise', analise: 'aprovado', aprovado: 'concluido', concluido: 'recebido', entregue: 'concluido' };
const QUOTE_SELECT = 'id, nome_cliente, telefone, email, codigo_cliente, codigo_retirada, itens, total, pagamento, status, status_entrega, created_at';
const PRODUCT_SELECT = 'id, codigo, nome, marca, categoria, subcategoria, preco, unidade, descricao, palavraschave, imagens, video, visivel, estoque, isdestaque, ispromocao, precopromocional, somente_orcamento, created_at, updated_at';
const CLIENT_SELECT = 'id, razao_social, cnpj, email, telefone, senha, senha_trocada, created_at, updated_at';
const PDF_HEADER_STYLE = 1;

// ---------- Helpers ----------
function formatPrice(v) { return 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function parsePrice(str) { if (str == null || str === '') return 0; let s = String(str).replace(/\./g, '').replace(/,/g, '.').replace(/[^\d.]/g, ''); const n = parseFloat(s); return isNaN(n) ? 0 : n; }
function priceInput(v) { if (v == null) return ''; return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function escapeHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function sha256Hex(str) { const input = String(str); if (!window.crypto || !window.crypto.subtle) { let hash = 0; for (let i = 0; i < input.length; i++) { hash = ((hash << 5) - hash) + input.charCodeAt(i); hash |= 0; } return Promise.resolve(('00000000' + (hash >>> 0).toString(16)).slice(-8)); } const buf = new TextEncoder().encode(input); return crypto.subtle.digest('SHA-256', buf).then(d => Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join('')); }
function cnpjDigits(s) { return String(s || '').replace(/\D/g, ''); }
function formatCnpj(c) { if (!c) return ''; const d = c.replace(/\D/g, ''); if (d.length !== 14) return c; return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5'); }
function timeAgo(ts) { if (!ts) return ''; const d = new Date(ts); const diff = Date.now() - d.getTime(); const min = Math.floor(diff / 60000); if (min < 1) return 'agora'; if (min < 60) return min + ' min atrás'; const hrs = Math.floor(min / 60); if (hrs < 24) return hrs + 'h atrás'; const days = Math.floor(hrs / 24); if (days < 7) return days + 'd atrás'; return d.toLocaleDateString('pt-BR'); }
function formatDate(ts) { if (!ts) return ''; const d = new Date(ts); return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
function toast(msg, isError) { const t = document.getElementById('toast'); if (!t) return; t.className = 'toast show' + (isError ? ' error' : ''); t.innerHTML = (isError ? '<i class="fas fa-exclamation-circle"></i>' : '<i class="fas fa-check-circle"></i>') + '<span>' + escapeHtml(msg) + '</span>'; clearTimeout(t._timer); t._timer = setTimeout(() => { t.className = 'toast'; }, 2600); }

// ---------- Navigation ----------
const VIEW_TITLES = { 'dashboard': 'Painel do Lojista', 'orcamentos': 'Gerenciar Orçamentos', 'produtos': 'Gerenciar Produtos', 'categorias': 'Gerenciar Categorias', 'clientes': 'Gerenciar Clientes', 'agendar': 'Agendar Visita' };

function switchView(view) {
    document.querySelectorAll('.dash-view').forEach(v => v.style.display = 'none');
    const el = document.getElementById('view-' + view);
    if (el) el.style.display = '';
    document.querySelectorAll('.dash-nav-item[data-view]').forEach(item => item.classList.toggle('active', item.dataset.view === view));
    document.getElementById('dashPageTitle').textContent = VIEW_TITLES[view] || 'Painel';
    if (view === 'orcamentos') renderQuotes();
    if (view === 'produtos') renderProducts();
    if (view === 'categorias') renderCategories();
    if (view === 'clientes') renderClients();
    if (view === 'agendar') { renderVisits(); renderVisitFrequencia(); }
    if (view === 'dashboard') renderOverview();
    document.getElementById('dashSidebar').classList.remove('open');
}

// ---------- Charts ----------
function getQuotesInPeriod(period) {
    const now = new Date();
    let since;
    if (period === 'today') { since = new Date(now.getFullYear(), now.getMonth(), now.getDate()); }
    else if (period === 'month') { since = new Date(now.getFullYear(), now.getMonth(), 1); }
    else { const d = parseInt(period) || 7; since = new Date(now.getTime() - d * 86400000); }
    return quotes.filter(q => new Date(q.created_at) >= since);
}

function buildQuoteChart(period) {
    const el = document.getElementById('chartQuotes');
    const empty = document.getElementById('chartQuotesEmpty');
    const periodQ = getQuotesInPeriod(period);
    if (empty) empty.style.display = periodQ.length ? 'none' : '';

    let labels = [];
    let dataReceived = [];
    let dataApproved = [];
    if (period === 'today') {
        for (let h = 8; h <= 20; h += 2) {
            labels.push(h + 'h');
            const lo = new Date(); lo.setHours(h, 0, 0, 0);
            const hi = new Date(lo.getTime() + 7200000);
            dataReceived.push(periodQ.filter(q => { const d = new Date(q.created_at); return d >= lo && d < hi; }).length);
            dataApproved.push(periodQ.filter(q => { const d = new Date(q.created_at); return d >= lo && d < hi && q.status === 'aprovado'; }).length);
        }
    } else if (period === 'month') {
        const now = new Date();
        const dayCount = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const step = Math.max(1, Math.floor(dayCount / 12));
        for (let i = 0; i < dayCount; i += step) {
            const d = new Date(now.getFullYear(), now.getMonth(), i + 1);
            const label = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
            labels.push(label);
            const lo = new Date(d.getFullYear(), d.getMonth(), d.getDate());
            const hi = new Date(lo.getTime() + 86400000);
            dataReceived.push(periodQ.filter(q => { const dd = new Date(q.created_at); return dd >= lo && dd < hi; }).length);
            dataApproved.push(periodQ.filter(q => { const dd = new Date(q.created_at); return dd >= lo && dd < hi && q.status === 'aprovado'; }).length);
        }
    } else {
        const days = parseInt(period) || 7;
        const buckets = Math.min(days, 12);
        const step = Math.max(1, Math.floor(days / buckets));
        for (let i = 0; i < days; i += step) {
            const d = new Date(); d.setDate(d.getDate() - i);
            const label = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
            labels.unshift(label);
            const lo = new Date(d.getFullYear(), d.getMonth(), d.getDate());
            const hi = new Date(lo.getTime() + 86400000);
            dataReceived.unshift(periodQ.filter(q => { const dd = new Date(q.created_at); return dd >= lo && dd < hi; }).length);
            dataApproved.unshift(periodQ.filter(q => { const dd = new Date(q.created_at); return dd >= lo && dd < hi && q.status === 'aprovado'; }).length);
        }
    }
    if (chartQuotesInstance) { chartQuotesInstance.destroy(); chartQuotesInstance = null; }
    if (!el) return;
    chartQuotesInstance = new Chart(el, {
        type: 'bar',
        data: { labels, datasets: [
            { label: 'Recebidos', data: dataReceived, backgroundColor: 'rgba(88,28,135,0.7)', borderRadius: 4 },
            { label: 'Aprovados', data: dataApproved, backgroundColor: 'rgba(46,213,115,0.7)', borderRadius: 4 }
        ]},
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top', labels: { font: { family: 'Chakra Petch', weight: '600', size: 11 } } } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1, font: { family: 'Chakra Petch' } } }, x: { ticks: { font: { family: 'Chakra Petch', size: 10 } } } } }
    });
}

function buildPaymentChart() {
    const el = document.getElementById('chartPayments');
    const empty = document.getElementById('chartPaymentsEmpty');
    const map = {};
    quotes.filter(q => q.status === 'concluido').forEach(q => {
        (Array.isArray(q.itens) ? q.itens : []).forEach(i => {
            let cat = i.categoria;
            if (!cat) {
                const prod = products.find(p => (p.codigo && p.codigo === i.codigo) || (p.nome && p.nome === i.nome));
                cat = prod?.categoria || 'Sem categoria';
            }
            map[cat] = (map[cat] || 0) + (Number(i.quantidade) || 0);
        });
    });
    const labels = Object.keys(map);
    const data = Object.values(map);
    if (empty) empty.style.display = labels.length ? 'none' : '';
    if (chartPaymentsInstance) { chartPaymentsInstance.destroy(); chartPaymentsInstance = null; }
    if (!el || !labels.length) return;
    const colors = ['#581c87', '#a855f7', '#00e5ff', '#ff2fe6', '#4f6bff', '#00ffa3', '#ff8a5c', '#e2363c', '#2ed573', '#ffa502'];
    chartPaymentsInstance = new Chart(el, {
        type: 'doughnut',
        data: { labels, datasets: [{ data, backgroundColor: colors.slice(0, labels.length), borderWidth: 0 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { font: { family: 'Chakra Petch', size: 11 }, padding: 10 } }, tooltip: { callbacks: { label: (ctx) => ' ' + (ctx.label || '') + ': ' + ctx.parsed + ' unid.' } } } }
    });
}

// ---------- Helpers ----------
function getQuoteClientName(q) {
    const email = (q.email || '').toLowerCase();
    const nome = (q.nome_cliente || '').toLowerCase();
    const client = clients.find(c => (c.email && c.email.toLowerCase() === email) || (c.razao_social && c.razao_social.toLowerCase() === nome));
    return client?.razao_social || q.nome_cliente || q.email || 'Desconhecido';
}

// ---------- Top clientes ----------
function renderTopClients() {
    const el = document.getElementById('topClients');
    if (!el) return;
    const periodQ = getQuotesInPeriod(currentChartPeriod).filter(q => q.status === 'concluido');
    const map = {};
    periodQ.forEach(q => {
        const email = (q.email || '').toLowerCase();
        const nome = (q.nome_cliente || '').toLowerCase();
        const client = clients.find(c => (c.email && c.email.toLowerCase() === email) || (c.razao_social && c.razao_social.toLowerCase() === nome));
        const displayName = client?.razao_social || q.nome_cliente || q.email || 'Desconhecido';
        const key = displayName.toLowerCase();
        if (!map[key]) map[key] = { nome: displayName, total: 0, pedidos: 0 };
        map[key].total += Number(q.total) || 0;
        map[key].pedidos += 1;
    });
    const top = Object.values(map).sort((a, b) => b.total - a.total).slice(0, 10);
    if (!top.length) { el.innerHTML = '<div class="empty-state"><i class="fas fa-users"></i><p>Nenhuma venda concluída neste período.</p></div>'; return; }
    const max = top[0].total || 1;
    el.innerHTML = top.map((c, i) => `
        <div class="top-client">
            <div class="top-client-rank">${i + 1}</div>
            <div class="top-client-body">
                <div class="top-client-name">${escapeHtml(c.nome)}</div>
                <div class="top-client-bar"><div class="top-client-bar-fill" style="width:${Math.max(4, (c.total / max) * 100)}%"></div></div>
            </div>
            <div class="top-client-meta">
                <span class="top-client-total">${formatPrice(c.total)}</span>
                <span class="top-client-count">${c.pedidos} ${c.pedidos === 1 ? 'pedido' : 'pedidos'}</span>
            </div>
        </div>`).join('');
}

// ---------- Mais vendidos ----------
function renderTopSellers() {
    const el = document.getElementById('topSellers');
    if (!el) return;
    if (!products.length) { el.innerHTML = '<div class="empty-state"><i class="fas fa-box-open"></i><p>Nenhum produto no catálogo.</p></div>'; return; }
    const sold = {};
    quotes.filter(q => q.status === 'concluido').forEach(q => {
        (Array.isArray(q.itens) ? q.itens : []).forEach(i => {
            const k = String((i.codigo || i.nome || '')).trim().toLowerCase();
            if (!k) return;
            sold[k] = (sold[k] || 0) + (Number(i.quantidade) || 0);
        });
    });
    const rows = products.map(p => {
        const kC = String(p.codigo || '').trim().toLowerCase();
        const kN = String(p.nome || '').trim().toLowerCase();
        const qty = Math.max(sold[kC] || 0, sold[kN] || 0);
        return { p, qty, total: qty * (Number(p.preco) || 0) };
    }).filter(r => r.qty > 0).sort((a, b) => b.qty - a.qty || (String(a.p.codigo || '').localeCompare(String(b.p.codigo || '')))).slice(0, 10);
    if (!rows.length) { el.innerHTML = '<div class="empty-state"><i class="fas fa-chart-line"></i><p>Nenhuma venda concluída ainda.</p></div>'; return; }
    const max = rows[0].qty || 1;
    el.innerHTML = rows.map((r, i) => `
        <div class="top-seller">
            <div class="top-seller-rank">${i + 1}</div>
            <div class="top-seller-body">
                <div class="top-seller-name">${escapeHtml(r.p.nome)} ${r.p.codigo ? '<small>' + escapeHtml(r.p.codigo) + '</small>' : ''}</div>
                <div class="top-seller-bar"><div class="top-seller-bar-fill" style="width:${Math.max(4, (r.qty / max) * 100)}%"></div></div>
            </div>
            <div class="top-seller-meta">
                <span class="top-seller-qty">${r.qty}x</span>
                <span class="top-seller-count">${formatPrice(r.total)}</span>
            </div>
        </div>`).join('');
}

// ---------- Menor saída ----------
function renderLowSellers() {
    const el = document.getElementById('lowSellers');
    if (!el) return;
    if (!products.length) { el.innerHTML = '<div class="empty-state"><i class="fas fa-box-open"></i><p>Nenhum produto no catálogo.</p></div>'; return; }
    const sold = {};
    quotes.filter(q => q.status === 'concluido').forEach(q => {
        (Array.isArray(q.itens) ? q.itens : []).forEach(i => {
            const k = String((i.codigo || i.nome || '')).trim().toLowerCase();
            if (!k) return;
            sold[k] = (sold[k] || 0) + (Number(i.quantidade) || 0);
        });
    });
    const rows = products.map(p => {
        const kC = String(p.codigo || '').trim().toLowerCase();
        const kN = String(p.nome || '').trim().toLowerCase();
        const qty = Math.max(sold[kC] || 0, sold[kN] || 0);
        return { p, qty };
    }).sort((a, b) => a.qty - b.qty || (String(a.p.codigo || '').localeCompare(String(b.p.codigo || '')))).slice(0, 7);
    const noneSold = rows.every(r => r.qty === 0);
    el.innerHTML = '<div class="low-seller-list">' + rows.map(r => {
        const p = r.p;
        const img = (p.imagens && p.imagens.length) ? p.imagens[0] : '';
        const imgHtml = img ? `<img src="${escapeHtml(img)}" alt="" onerror="this.style.display='none'">` : '<div class="low-no-img"><i class="fas fa-box-open"></i></div>';
        const badge = r.qty === 0
            ? '<span class="low-badge low-zero"><i class="fas fa-ban"></i> Zerada</span>'
            : (r.qty <= 1 ? '<span class="low-badge low-warn"><i class="fas fa-chevron-down"></i> Baixíssima</span>' : '<span class="low-badge"><i class="fas fa-arrow-down"></i> ' + r.qty + ' vendidos</span>');
        return `<div class="low-seller">
            <div class="low-seller-head">
                ${imgHtml}
                <div class="low-seller-info">
                    <div class="low-seller-name">${escapeHtml(p.nome)} ${p.codigo ? '<small>' + escapeHtml(p.codigo) + '</small>' : ''}</div>
                    <div class="low-seller-meta"><span>${escapeHtml(p.categoria || 'Sem categoria')}</span>${p.marca ? '<span>' + escapeHtml(p.marca) + '</span>' : ''}<span>Estoque: ${p.estoque}</span>${(p.ispromocao && p.precopromocional > 0) ? '<span class="low-promo-on">Em promoção</span>' : ''}</div>
                    ${badge}
                </div>
                <div class="low-seller-price">${formatPrice(p.preco)}</div>
            </div>
            <div class="low-seller-tip"><i class="fas fa-lightbulb"></i> ${lowSellerTip(p, r.qty)}</div>
        </div>`;
    }).join('') + '</div>';
    if (noneSold) el.innerHTML = '<div class="empty-state"><i class="fas fa-box-open"></i><p>Nenhuma venda concluída ainda. Os 7 primeiros do catálogo aparecem acima como candidatos a promoção.</p></div>';
}

function lowSellerTip(p, qty) {
    const tips = [];
    if (qty === 0) tips.push('Nenhuma venda ainda. Considere destacar no catálogo, criar um "produto estrela" com desconto inicial.');
    if (p.estoque > 20) tips.push('Estoque alto (' + p.estoque + '): boa chance de "queima" com preço promocional por tempo limitado.');
    if (p.precopromocional > 0 && qty > 0 && qty <= 2) tips.push('Já está em promoção mas ainda sai pouco — avalie mudar o posicionamento ou agrupar em "leve 3 pague 2".');
    if (p.ispromocao && qty === 0) tips.push('Está marcado como promoção, mas sem vendas — reveja o preço promocional e o destaque na vitrine.');
    if (p.isdestaque && qty <= 2) tips.push('É destaque, mas com baixa saída — experimente reposicionar na grade ou usar em kits.');
    if (p.visivel === false) tips.push('Produto oculto da vitrine — relembre se deve estar visível antes de investir em promoção.');
    if (tips.length < 2) tips.push('Use em "casa cheia" de kits: combine com outros itens da mesma categoria (' + escapeHtml(p.categoria || 'geral') + ') para aumentar o ticket médio.');
    tips.push('Crie um pente de desconto progressivo no WhatsApp: leve 5+ unidades e ganhe 10% de desconto.');
    if (tips.length < 3) tips.push('Destaque o produto em uma campanha de WhatsApp para lojistas da sua base de clientes.');
    return tips.slice(0, 3).join(' ');
}

// ---------- Overview ----------
async function renderOverview() {
    document.getElementById('metricQuotes').textContent = quotes.length;
    document.getElementById('metricSales').textContent = quotes.filter(q => q.status === 'concluido').length;
    const totalSold = quotes.filter(q => q.status === 'concluido').reduce((s, q) => s + (Number(q.total) || 0), 0);
    document.getElementById('metricSold').textContent = formatPrice(totalSold);
    const soldClients = new Set(quotes.filter(q => q.status === 'concluido').map(q => q.email || q.nome_cliente));
    document.getElementById('metricClients').textContent = soldClients.size;
    const soldItems = quotes.filter(q => q.status === 'concluido').reduce((s, q) => s + (Array.isArray(q.itens) ? q.itens.reduce((a, i) => a + (Number(i.quantidade) || 0), 0) : 0), 0);
    document.getElementById('metricSoldItems').textContent = soldItems;

    buildQuoteChart(currentChartPeriod);
    buildPaymentChart();
    renderTopClients();
    renderTopSellers();
    renderLowSellers();

    const recent = quotes.slice(-6).reverse();
    const el = document.getElementById('recentQuotes');
    el.innerHTML = recent.length ? recent.map(q => `
        <div class="quote-card">
            <div class="quote-card-main">
                <div class="quote-card-top">
                    <span class="quote-card-name">${escapeHtml(q.nome_cliente)}</span>
                    <span class="status-pill status-${escapeHtml(q.status)}">${statusLabel(q.status)}</span>
                </div>
                <div class="quote-card-meta">
                    <span><i class="fas fa-envelope"></i>${escapeHtml(q.email || '')}</span>
                    ${q.telefone ? `<span><i class="fas fa-phone"></i>${escapeHtml(q.telefone)}</span>` : ''}
                    <span><i class="fas fa-clock"></i>${timeAgo(q.created_at)}</span>
                </div>
            </div>
            <div class="quote-card-total">${formatPrice(q.total)}</div>
            <button class="icon-btn" onclick="openQuoteDetail('${q.id}')" title="Detalhes"><i class="fas fa-eye"></i></button>
        </div>
    `).join('') : '<div class="empty-state"><i class="fas fa-inbox"></i><p>Nenhum orçamento ainda</p></div>';
}

// ---------- Quotes ----------
function statusLabel(s) { const map = { recebido: 'Recebido', analise: 'Em análise', aprovado: 'Aprovado', entregue: 'Entregue', concluido: 'Concluído', cancelado: 'Cancelado' }; return map[s] || s; }

async function loadQuotes() {
    try { let all = []; let from = 0; while (true) { const { data, error } = await db.from(SUPABASE_QUOTES_TABLE).select(QUOTE_SELECT).order('created_at', { ascending: false }).range(from, from + 499); if (error) throw error; if (!data || !data.length) break; all = all.concat(data); if (data.length < 500) break; from += 500; } quotes = all; } catch (e) { console.error('Erro ao carregar orçamentos:', e); quotes = []; }
    updatePendingBadge();
}

function updatePendingBadge() { const badge = document.getElementById('pendingQuotesBadge'); if (!badge) return; const n = quotes.filter(q => q.status === 'recebido').length; badge.textContent = n; badge.style.display = n > 0 ? '' : 'none'; }

function renderQuotes() {
    const statusFilter = document.getElementById('statusFilter').value;
    const search = document.getElementById('quoteSearch').value.trim().toLowerCase();
    let list = quotes;
    if (statusFilter !== 'all') list = list.filter(q => q.status === statusFilter);
    if (search) list = list.filter(q => (q.nome_cliente || '').toLowerCase().includes(search) || (q.email || '').toLowerCase().includes(search) || (q.telefone || '').toLowerCase().includes(search) || (q.codigo_cliente || '').toLowerCase().includes(search));
    const el = document.getElementById('quoteList');
    if (!list.length) { el.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><p>Nenhum orçamento encontrado</p></div>'; return; }
    el.innerHTML = list.map(q => `
        <div class="quote-card">
            <div class="quote-card-row">
                <div class="quote-main-info">
                    <span class="quote-card-name">${escapeHtml(q.nome_cliente)}</span>
                    <span class="quote-code-badge">#${escapeHtml(q.codigo_cliente || q.id)}</span>
                    <span class="quote-meta-icons">
                        ${q.email ? `<span title="Email"><i class="fas fa-envelope"></i>${escapeHtml(q.email)}</span>` : ''}
                        ${q.telefone ? `<span title="Telefone"><i class="fas fa-phone"></i>${escapeHtml(q.telefone)}</span>` : ''}
                        ${q.codigo_retirada ? `<span title="Retirada"><i class="fas fa-barcode"></i>${escapeHtml(q.codigo_retirada)}</span>` : ''}
                        <span title="Data"><i class="fas fa-clock"></i>${formatDate(q.created_at)}</span>
                    </span>
                </div>
                <div class="quote-card-footer">
                    <span class="quote-status-before-total status-${escapeHtml(q.status)}">${statusLabel(q.status)}</span>
                    <div class="quote-card-total">${formatPrice(q.total)}</div>
                </div>
                <div class="quote-card-actions">
                    <button class="icon-btn" onclick="openQuoteDetail('${q.id}')" title="Detalhes"><i class="fas fa-eye"></i></button>
                    <button class="icon-btn pdf" onclick="downloadQuotePDF('${q.id}')" title="Baixar PDF"><i class="fas fa-file-pdf"></i></button>
                    <button class="icon-btn" onclick="editQuote('${q.id}')" title="Editar"><i class="fas fa-pen"></i></button>
                    <button class="icon-btn" onclick="advanceQuote('${q.id}')" title="Avançar status"><i class="fas fa-arrow-right"></i></button>
                    <a class="icon-btn" href="https://wa.me/${(q.telefone||'').replace(/\D/g,'') || WHATSAPP_NUMBER}" target="_blank" title="WhatsApp"><i class="fab fa-whatsapp"></i></a>
                    <button class="icon-btn danger" onclick="deleteQuote('${q.id}')" title="Excluir"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        </div>`).join('');
}

function openQuoteDetail(id) {
    try {
    const q = quotes.find(x => String(x.id) === String(id));
    if (!q) return;
    const items = (Array.isArray(q.itens) && q.itens.length) ? q.itens : null;
    let itemsHtml = '';
    if (items) { itemsHtml = '<div class="qd-items">' + items.map(it => `<div class="qd-item"><span>${escapeHtml(it.nome || '')} ${it.codigo ? '(' + escapeHtml(it.codigo) + ')' : ''} <small>${it.quantidade}x</small></span><span>${formatPrice(it.subtotal || (it.preco * it.quantidade))}</span></div>`).join('') + '</div>'; }
    else if (q.itens && typeof q.itens === 'string') { itemsHtml = '<p style="color:var(--text-secondary);font-size:0.85rem;white-space:pre-wrap">' + escapeHtml(q.itens) + '</p>'; }

    document.getElementById('quoteDetailBody').innerHTML = `
        <div class="qd-row"><span>Cliente</span><span>${escapeHtml(q.nome_cliente)}</span></div>
        <div class="qd-row"><span>Email</span><span>${escapeHtml(q.email || '')}</span></div>
        <div class="qd-row"><span>Telefone</span><span>${escapeHtml(q.telefone || '')}</span></div>
        <div class="qd-row"><span>Código Cliente</span><span>${escapeHtml(q.codigo_cliente || '')}</span></div>
        <div class="qd-row"><span>Código Retirada</span><span>${escapeHtml(q.codigo_retirada || '')}</span></div>
        <div class="qd-row"><span>Data</span><span>${formatDate(q.created_at)}</span></div>
        <div class="qd-row"><span>Status</span><span><span class="status-pill status-${escapeHtml(q.status)}">${statusLabel(q.status)}</span></span></div>
        ${itemsHtml}
        ${q.pagamento ? `<div class="qd-row"><span>Prazo</span><span>${escapeHtml(q.pagamento)}</span></div>` : ''}
        <div class="qd-row"><span>Total</span><span style="font-weight:700;color:var(--accent)">${formatPrice(q.total)}</span></div>
        <div class="qd-actions">
            <button class="btn btn-whatsapp-outline" onclick="downloadQuotePDF('${q.id}')"><i class="fas fa-file-pdf"></i> Baixar PDF</button>
            <a class="btn btn-whatsapp-outline" href="https://wa.me/${(q.telefone||'').replace(/\D/g,'') || WHATSAPP_NUMBER}?text=${encodeURIComponent(buildQuoteMessage(q))}" target="_blank"><i class="fab fa-whatsapp"></i> Enviar WhatsApp</a>
            <button class="btn btn-primary" onclick="editQuote('${q.id}')"><i class="fas fa-pen"></i> Editar</button>
        </div>
        <div class="qd-status-form">
            <label style="font-size:0.8rem;color:var(--text-secondary);display:block;margin-bottom:6px">Alterar status</label>
            <div style="display:flex;gap:8px">
                <select class="dash-select" id="qdStatusSelect" style="flex:1;min-width:0">
                    ${STATUS_FLOW.map(s => `<option value="${s}" ${s === q.status ? 'selected' : ''}>${statusLabel(s)}</option>`).join('')}
                </select>
                <button class="btn btn-primary btn-sm" onclick="changeQuoteStatus('${q.id}')"><i class="fas fa-check"></i> Aplicar</button>
            </div>
        </div>`;
    document.getElementById('quoteDetailModal').classList.add('open');
    } catch (e) { console.error(e); toast('Erro ao abrir detalhes: ' + e.message, true); }
}

async function changeQuoteStatus(id) { const sel = document.getElementById('qdStatusSelect'); const newStatus = sel.value; const { error } = await db.from(SUPABASE_QUOTES_TABLE).update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', id); if (error) { toast('Erro: ' + error.message, true); return; } const q = quotes.find(x => String(x.id) === String(id)); if (q) q.status = newStatus; updatePendingBadge(); document.getElementById('quoteDetailModal').classList.remove('open'); renderQuotes(); toast('Status atualizado para ' + statusLabel(newStatus)); }

async function advanceQuote(id) { const q = quotes.find(x => String(x.id) === String(id)); if (!q) return; const next = STATUS_NEXT[q.status]; if (!next) { toast('Orçamento cancelado', true); return; } const { error } = await db.from(SUPABASE_QUOTES_TABLE).update({ status: next, updated_at: new Date().toISOString() }).eq('id', id); if (error) { toast('Erro: ' + error.message, true); return; } q.status = next; updatePendingBadge(); renderQuotes(); toast('Status avançado para ' + statusLabel(next)); }

async function deleteQuote(id) { if (!confirm('Excluir este orçamento?')) return; const { error } = await db.from(SUPABASE_QUOTES_TABLE).delete().eq('id', id); if (error) { toast('Erro: ' + error.message, true); return; } quotes = quotes.filter(x => String(x.id) !== String(id)); updatePendingBadge(); renderQuotes(); toast('Orçamento excluído'); }

function buildQuoteMessage(q) { const lines = ['*ORÇAMENTO - JAVA DISTRIBUIDORA*', '']; if (q.codigo_cliente) lines.push('Cliente: ' + q.nome_cliente + ' (#' + q.codigo_cliente + ')'); else lines.push('Cliente: ' + q.nome_cliente); if (q.codigo_retirada) lines.push('Cód. Retirada: ' + q.codigo_retirada); lines.push('Data: ' + formatDate(q.created_at)); lines.push(''); if (Array.isArray(q.itens) && q.itens.length) { q.itens.forEach(it => { lines.push('• ' + it.nome + ' (' + (it.codigo||'') + ')'); lines.push('  ' + it.quantidade + 'x ' + formatPrice(it.preco) + ' = ' + formatPrice(it.subtotal || (it.preco * it.quantidade))); }); } else { lines.push(String(q.itens || '')); } lines.push(''); lines.push('Total: ' + formatPrice(q.total)); if (q.pagamento) lines.push('Prazo de pagamento: ' + q.pagamento); lines.push(''); lines.push('WhatsApp: (12) 99778-0047'); return lines.join('\n'); }

function buildPaymentLines(pagamento, baseDate, total) { if (!pagamento) return []; const p = String(pagamento).trim(); const pLower = p.toLowerCase(); const nums = p.match(/\d+/g) || []; let prazos = []; if (/^\d+x$/i.test(p)) { const n = parseInt(nums[0]); if (n > 1) for (let i = 1; i <= n; i++) prazos.push(30 * i); } else if (/boleto/.test(pLower)) { prazos.push(nums.length ? parseInt(nums[0]) : 30); } else if (nums.length) { prazos = nums.map(n => parseInt(n)).filter(n => n > 0); } if (!prazos.length) return []; const base = baseDate ? new Date(baseDate) : new Date(); const qtd = prazos.length; const valorParcela = Number(total) > 0 ? Number(total) / qtd : 0; return prazos.map((dias, i) => { const dt = new Date(base.getTime() + dias * 86400000); const dia = dt.toLocaleDateString('pt-BR'); const parcelaText = prazos.length === 1 ? 'Vencimento em ' + dia + ' (' + dias + ' dias)' : (i + 1) + 'ª parcela' + (dias ? ' (' + dias + ' dias)' : '') + ' — ' + dia; return valorParcela > 0 ? parcelaText + ' — ' + formatPrice(valorParcela) : parcelaText; }); }

function downloadQuotePDF(id) { const q = quotes.find(x => String(x.id) === String(id)); if (!q) return; if (!window.jspdf || !window.jspdf.jsPDF) { toast('Biblioteca de PDF não carregada (verifique a conexão).', true); return; } const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: 'mm', format: 'a4' }); const pageW = 210, margin = 16; const width = pageW - margin * 2; let y = margin; const brand = '#581c87'; const light = '#5b5466'; const subX = pageW - margin;

    const Hd = 40; const hStyle = PDF_HEADER_STYLE || 1; const pink = [255, 47, 230]; let bg, tc, sc, divC;
    if (hStyle === 3) { bg = [72, 72, 78]; tc = [255, 255, 255]; sc = [238, 214, 244]; divC = [255, 255, 255]; }
    else if (hStyle === 2) { bg = [230, 230, 233]; tc = [20, 20, 26]; sc = [96, 96, 106]; divC = [210, 170, 225]; }
    else { bg = [255, 255, 255]; tc = [20, 20, 26]; sc = [96, 96, 106]; divC = [226, 120, 210]; }
    doc.setFillColor(bg[0], bg[1], bg[2]); doc.rect(0, 0, pageW, Hd, 'F');
    doc.setFillColor(pink[0], pink[1], pink[2]); doc.rect(0, Hd, pageW, 2.2, 'F');

    if (typeof COMPANY_LOGO_DATA === 'string' && COMPANY_LOGO_DATA) { try { if (hStyle === 3) { doc.setFillColor(255, 255, 255); doc.rect(margin, 5, 34, 24, 'F'); doc.addImage(COMPANY_LOGO_DATA, 'PNG', margin + 2, 7, 30, 20); } else { doc.addImage(COMPANY_LOGO_DATA, 'PNG', margin, 8, 34, 24); } } catch (e) {} }

    doc.setTextColor(sc[0], sc[1], sc[2]); doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.text('EMITIDO EM ' + formatDate(q.created_at), pageW - margin, 12, { align: 'right' });
    doc.setTextColor(tc[0], tc[1], tc[2]); doc.setFont('helvetica', 'bold'); doc.setFontSize(19); doc.text('ORÇAMENTO N° ' + String(q.id || '').padStart(5, '0'), pageW / 2, 20, { align: 'center' });
    doc.setDrawColor(divC[0], divC[1], divC[2]); doc.setLineWidth(0.4); doc.line(pageW / 2 - 42, 24.5, pageW / 2 + 42, 24.5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(sc[0], sc[1], sc[2]); doc.text('Java Distribuidora', pageW / 2, 30, { align: 'center' }); doc.setLineWidth(0.2);
    y = Hd + 12;

    doc.setTextColor(brand); doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('DADOS DO CLIENTE', margin, y); doc.setDrawColor(216, 180, 254); doc.line(margin, y + 1.5, pageW - margin, y + 1.5); y += 9;
    doc.setTextColor(30, 30, 40); doc.setFontSize(10);
    let cnpjCliente = ''; const cCliente = clients.find(c => c && c.razao_social && c.razao_social.toLowerCase() === String(q.nome_cliente || '').toLowerCase()); if (cCliente && cCliente.cnpj) cnpjCliente = formatCnpj(cCliente.cnpj);
    const colHalf = pageW / 2; let colIdx = 0;
    [['Cliente', q.nome_cliente], ['CNPJ', cnpjCliente], ['Email', q.email], ['Telefone', q.telefone]].filter(r => r[1]).forEach(row => { const cx = colIdx % 2 === 0 ? margin : colHalf; const cy = y + Math.floor(colIdx / 2) * 12; doc.setFont('helvetica', 'bold'); doc.setTextColor(light); doc.setFontSize(8); doc.text(row[0].toUpperCase(), cx, cy); doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 30, 40); doc.setFontSize(10); let val = String(row[1]); if (doc.getTextWidth(val) > colHalf - margin - 4) val = doc.splitTextToSize(val, colHalf - margin - 4)[0]; doc.text(val, cx, cy + 6); colIdx++; });
    y += Math.ceil(colIdx / 2) * 12 + 4;

    doc.setTextColor(brand); doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('ITENS DO ORÇAMENTO', margin, y); doc.setDrawColor(216, 180, 254); doc.line(margin, y + 1.5, pageW - margin, y + 1.5); y += 9;
    const codeX = margin, descX = margin + 26, qtyX = subX - 70, unitX = subX - 44;
    doc.setFillColor(247, 243, 255); doc.rect(margin, y, width, 9, 'F');
    doc.setTextColor(brand); doc.setFontSize(9); doc.setFont('helvetica', 'bold');
    doc.text('CÓDIGO', codeX, y + 6); doc.text('PRODUTO', descX, y + 6); doc.text('QTDE', qtyX, y + 6, { align: 'right' }); doc.text('UNIT', unitX, y + 6, { align: 'right' }); doc.text('SUBTOTAL', subX, y + 6, { align: 'right' }); y += 15;
    doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 30, 40); doc.setFontSize(9.5);
    const items = (Array.isArray(q.itens) && q.itens.length) ? q.itens : null;
    if (items) { items.forEach(it => { if (y > 272) { doc.addPage(); y = margin; } const name = it.nome || ''; const code = it.codigo || ''; const qty = it.quantidade || 0; const unit = it.preco || 0; const sub = it.subtotal || (unit * qty); doc.setFillColor(245, 245, 248); doc.setDrawColor(235, 230, 242); doc.rect(margin, y - 5.5, width, 14, 'FD'); doc.setFont('helvetica', 'bold'); doc.setTextColor(130, 130, 140); doc.text(String(code), codeX, y); doc.setFont('helvetica', 'bold'); doc.setTextColor(30, 30, 40); let descTxt = name; if (doc.getTextWidth(descTxt) > qtyX - descX - 6) descTxt = doc.splitTextToSize(descTxt, qtyX - descX - 6)[0]; doc.text(descTxt, descX, y); doc.setFont('helvetica', 'normal'); doc.text(String(qty), qtyX, y, { align: 'right' }); doc.text(formatPrice(unit), unitX, y, { align: 'right' }); doc.setFont('helvetica', 'bold'); doc.text(formatPrice(sub), subX, y, { align: 'right' }); y += 16; }); }
    y += 4; if (y > 275) { doc.addPage(); y = margin; }
    doc.setDrawColor(216, 180, 254); doc.line(margin, y, pageW - margin, y); y += 8;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(brand); doc.text('TOTAL', margin, y); doc.text(formatPrice(q.total || 0), subX, y, { align: 'right' }); y += 8;
    if (q.pagamento) { const payLines = buildPaymentLines(q.pagamento, q.created_at, q.total); doc.setFontSize(10); doc.setTextColor(30, 30, 40); doc.setFont('helvetica', 'bold'); doc.text('Forma de pagamento:', margin, y); doc.setFont('helvetica', 'normal'); doc.text(String(q.pagamento), margin + 50, y); y += 7; payLines.forEach(l => { if (y > 275) { doc.addPage(); y = margin; } doc.setFontSize(9.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 30, 40); doc.text('• ' + l, margin, y); y += 6; }); }
    for (let i = 1; i <= doc.internal.getNumberOfPages(); i++) { doc.setPage(i); doc.setFontSize(8); doc.setTextColor(154, 147, 168); doc.setFont('helvetica', 'normal'); doc.text('Java Distribuidora • (12) 99778-0047 • Pedido mínimo R$ 300,00', pageW / 2, 289, { align: 'center' }); doc.text('Página ' + i + '/' + doc.internal.getNumberOfPages(), pageW - margin, 289, { align: 'right' }); }
    const fileName = 'orcamento-' + (q.nome_cliente ? q.nome_cliente.replace(/[^\w\s]/g, '').trim().replace(/\s+/g, '_') : 'cliente') + '-' + q.id + '.pdf'; doc.save(fileName); toast('PDF do orçamento baixado.'); }

// ---------- Products ----------
async function loadProducts() { try { let all = []; let from = 0; while (true) { const { data, error } = await db.from(SUPABASE_PRODUCTS_TABLE).select(PRODUCT_SELECT).order('id', { ascending: true }).range(from, from + 499); if (error) throw error; if (!data || !data.length) break; all = all.concat(data); if (data.length < 500) break; from += 500; } products = all; } catch (e) { console.error('Erro ao carregar produtos:', e); products = []; } }

function renderProducts() { const search = document.getElementById('productSearch').value.trim().toLowerCase(); let list = products; if (search) list = list.filter(p => (p.nome || '').toLowerCase().includes(search) || (p.codigo || '').toLowerCase().includes(search) || (p.marca || '').toLowerCase().includes(search) || (p.categoria || '').toLowerCase().includes(search)); const tbody = document.getElementById('productTableBody'); if (!list.length) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text-muted)">Nenhum produto encontrado</td></tr>'; return; } tbody.innerHTML = list.map(p => { const img = (p.imagens && p.imagens.length) ? p.imagens[0] : ''; const imgHtml = img ? `<img class="prod-img" src="${escapeHtml(img)}" alt="" onerror="this.onerror=null;this.style.display='none'">` : '<div class="prod-no-img"><i class="fas fa-image"></i></div>'; return `<tr><td data-label="Imagem">${imgHtml}</td><td data-label="Código"><span class="prod-code">${escapeHtml(p.codigo || '—')}</span></td><td data-label="Produto"><div class="prod-name">${escapeHtml(p.nome)}</div><div class="prod-code">${escapeHtml(p.marca || '')}</div></td><td data-label="Categoria">${escapeHtml(p.categoria || '')}</td><td data-label="Preço" class="price-cell">${formatPrice(p.preco)}${p.ispromocao && p.precopromocional > 0 ? `<br><small style="color:var(--warning)">Promo: ${formatPrice(p.precopromocional)}</small>` : ''}</td><td data-label="Estoque">${p.estoque}</td><td data-label="Visível"><button class="toggle ${p.visivel ? 'on' : ''}" onclick="toggleVisibility('${p.id}')" title="Visível no catálogo"></button></td><td data-label="Ações"><div style="display:flex;gap:6px"><button class="icon-btn" onclick="openProductModal('${p.id}')" title="Editar"><i class="fas fa-pen"></i></button><button class="icon-btn danger" onclick="deleteProduct('${p.id}')" title="Excluir"><i class="fas fa-trash"></i></button></div></td></tr>`; }).join(''); }

async function toggleVisibility(id) { const p = products.find(x => String(x.id) === String(id)); if (!p) return; const newVal = !p.visivel; const { error } = await db.from(SUPABASE_PRODUCTS_TABLE).update({ visivel: newVal, updated_at: new Date().toISOString() }).eq('id', id); if (error) { toast('Erro: ' + error.message, true); return; } p.visivel = newVal; renderProducts(); toast(newVal ? 'Produto visível no catálogo' : 'Produto oculto do catálogo'); }
async function deleteProduct(id) { if (!confirm('Excluir este produto?')) return; const { error } = await db.from(SUPABASE_PRODUCTS_TABLE).delete().eq('id', id); if (error) { toast('Erro: ' + error.message, true); return; } products = products.filter(x => String(x.id) !== String(id)); renderProducts(); toast('Produto excluído'); }

// ---------- Product modal ----------
let editingImages = [];
function fillCategorySelects() { const catSel = document.getElementById('prodCategoria'); catSel.innerHTML = '<option value="">Sem categoria</option>' + categories.map(c => `<option value="${escapeHtml(c.nome)}">${escapeHtml(c.nome)}</option>`).join(''); fillSubcatSelect(); }
function fillSubcatSelect() { const cat = document.getElementById('prodCategoria').value; const subSel = document.getElementById('prodSubcategoria'); const current = subSel.value; const subs = categories.length && cat ? categories.filter(c => c.nome === cat).flatMap(c => c.subcategorias || []) : []; subSel.innerHTML = '<option value="">Sem subcategoria</option>' + subs.map(s => `<option value="${escapeHtml(s)}" ${s === current ? 'selected' : ''}>${escapeHtml(s)}</option>`).join(''); }

function openProductModal(id) { editingImages = []; pendingUploads = []; document.getElementById('productForm').reset(); document.getElementById('promoPriceField').style.display = 'none'; fillCategorySelects(); const title = document.getElementById('productModalTitle'); const isNew = (id == null); if (isNew) { title.textContent = 'Novo Produto'; document.getElementById('productId').value = ''; document.getElementById('prodEstoque').value = 0; document.getElementById('prodUnidade').value = 'UN'; } else { const p = products.find(x => String(x.id) === String(id)); if (!p) return; title.textContent = 'Editar — ' + (p.codigo || p.nome); document.getElementById('productId').value = p.id; document.getElementById('prodCodigo').value = p.codigo || ''; document.getElementById('prodNome').value = p.nome || ''; document.getElementById('prodMarca').value = p.marca || ''; document.getElementById('prodCategoria').value = p.categoria || ''; fillSubcatSelect(); document.getElementById('prodSubcategoria').value = p.subcategoria || ''; document.getElementById('prodPreco').value = priceInput(p.preco); document.getElementById('prodEstoque').value = p.estoque || 0; document.getElementById('prodUnidade').value = p.unidade || 'UN'; document.getElementById('prodDescricao').value = p.descricao || ''; document.getElementById('prodKeywords').value = (Array.isArray(p.palavraschave) ? p.palavraschave : []).join(', '); document.getElementById('prodDestaque').checked = !!p.isdestaque; document.getElementById('prodPromocao').checked = !!p.ispromocao; document.getElementById('prodSomenteOrcamento').checked = !!p.somente_orcamento; document.getElementById('prodPrecoPromo').value = priceInput(p.precopromocional); if (p.ispromocao) document.getElementById('promoPriceField').style.display = ''; editingImages = Array.isArray(p.imagens) ? p.imagens.slice() : []; renderImgPreviews(); fillImgUrlInputs(); } document.getElementById('productModal').classList.add('open'); }
function closeProductModal() {
    document.getElementById('productModal').classList.remove('open');
    pendingUploads = [];
    editingImages = [];
    document.getElementById('imgPreviews').innerHTML = '';
    for (let i = 1; i <= 5; i++) {
        const el = document.getElementById('prodImg' + i);
        if (el) el.value = '';
    }
    const fileInput = document.getElementById('imgFileInput');
    if (fileInput) fileInput.value = '';
}
function renderImgPreviews() { const wrap = document.getElementById('imgPreviews'); wrap.innerHTML = editingImages.map((url, i) => `<div class="img-preview"><img src="${escapeHtml(url)}" alt="" onerror="this.onerror=null;this.style.display='none'"><button type="button" class="remove-img" onclick="removeEditingImage(${i})"><i class="fas fa-xmark"></i></button></div>`).join(''); }
function removeEditingImage(i) { editingImages.splice(i, 1); renderImgPreviews(); fillImgUrlInputs(); }
function fillImgUrlInputs() { for (let i = 0; i < 5; i++) { document.getElementById('prodImg' + (i + 1)).value = editingImages[i] || ''; } }

function hashFileBuffer(buffer) { if (!window.crypto || !window.crypto.subtle) { let hash = 0; const arr = new Uint8Array(buffer); for (let i = 0; i < arr.length; i++) { hash = ((hash << 5) - hash) + arr[i]; hash |= 0; } return Promise.resolve(('00000000' + (hash >>> 0).toString(16)).slice(-8)); } return crypto.subtle.digest('SHA-256', buffer).then(h => Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('')); }
async function fileToWebP(file, width) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = (e) => { const img = new Image(); img.onload = () => { const canvas = document.createElement('canvas'); let w = img.width, h = img.height; if (w > width) { h = Math.round(h * width / w); w = width; } canvas.width = w; canvas.height = h; canvas.getContext('2d').drawImage(img, 0, 0, w, h); canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('falha')), 'image/webp', 0.8); }; img.onerror = () => reject(new Error('imagem inválida')); img.src = e.target.result; }; reader.onerror = () => reject(new Error('leitura falhou')); reader.readAsDataURL(file); }); }
async function uploadToR2(webpMain, webpThumb, hash) { if (typeof R2_WORKER_URL === 'undefined' || !R2_WORKER_URL || typeof R2_PUBLIC_BASE_URL === 'undefined' || !R2_PUBLIC_BASE_URL) throw new Error('R2 não configurado: verifique js/r2-config.js'); const form = new FormData(); form.append('main', webpMain, hash + '.webp'); form.append('thumb', webpThumb, hash + '_thumb.webp'); form.append('hash', hash); const headers = {}; if (typeof R2_WORKER_SECRET !== 'undefined' && R2_WORKER_SECRET) headers['Authorization'] = 'Bearer ' + R2_WORKER_SECRET; const res = await fetch(R2_WORKER_URL + '/upload', { method: 'POST', body: form, headers }); if (!res.ok) { let msg = 'Falha no upload (' + res.status + ')'; try { const d = await res.json(); if (d.error) msg += ': ' + d.error; } catch (e) {} throw new Error(msg); } return { main: R2_PUBLIC_BASE_URL + '/produtos/' + hash + '.webp', thumb: R2_PUBLIC_BASE_URL + '/produtos/' + hash + '_thumb.webp' }; }
function showUploading(btn, on) { btn.disabled = on; if (on) { btn.dataset.orig = btn.innerHTML; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...'; } else { if (btn.dataset.orig) btn.innerHTML = btn.dataset.orig; } }

async function saveProduct(e) { e.preventDefault(); const btn = document.getElementById('productSubmit'); showUploading(btn, true); try { const id = document.getElementById('productId').value; const uploadedNew = []; if (pendingUploads && pendingUploads.length) { for (const f of pendingUploads) { try { const buffer = await f.arrayBuffer(); const hash = await hashFileBuffer(buffer); const [main, thumb] = await Promise.all([fileToWebP(f, 1200), fileToWebP(f, 400)]); const uploaded = await uploadToR2(main, thumb, hash); uploadedNew.push(uploaded.main); } catch (uploadErr) { console.error('Erro upload R2:', uploadErr); toast('Falha ao enviar imagem para R2: ' + uploadErr.message, true); showUploading(btn, false); return; } } pendingUploads = []; } const urlImgs = []; for (let i = 0; i < 5; i++) { const v = document.getElementById('prodImg' + (i + 1)).value.trim(); if (v) urlImgs.push(v); } editingImages = urlImgs.length ? urlImgs : []; if (uploadedNew.length) editingImages = editingImages.concat(uploadedNew).slice(0, 5); const palavraschave = document.getElementById('prodKeywords').value.split(',').map(s => s.trim()).filter(Boolean); const isp = document.getElementById('prodPromocao').checked; const somenteOrcamento = document.getElementById('prodSomenteOrcamento').checked; const payload = { codigo: document.getElementById('prodCodigo').value.trim() || null, nome: document.getElementById('prodNome').value.trim(), marca: document.getElementById('prodMarca').value.trim(), categoria: document.getElementById('prodCategoria').value, subcategoria: document.getElementById('prodSubcategoria').value || null, preco: parsePrice(document.getElementById('prodPreco').value), unidade: document.getElementById('prodUnidade').value, descricao: document.getElementById('prodDescricao').value, palavraschave, imagens: editingImages, estoque: parseInt(document.getElementById('prodEstoque').value) || 0, isdestaque: document.getElementById('prodDestaque').checked, ispromocao: isp, precopromocional: isp ? parsePrice(document.getElementById('prodPrecoPromo').value) : 0, somente_orcamento: somenteOrcamento, visivel: true, updated_at: new Date().toISOString() }; let error; if (id) { const r = await db.from(SUPABASE_PRODUCTS_TABLE).update(payload).eq('id', id); error = r.error; } else { const r = await db.from(SUPABASE_PRODUCTS_TABLE).insert(payload); error = r.error; } if (error) throw new Error(error.message); closeProductModal(); await loadProducts(); renderProducts(); toast(r2NotConfigured ? 'Produto salvo, mas imagens não enviadas (R2 ainda não configurado)' : 'Produto salvo com sucesso'); } catch (err) { console.error(err); toast('Erro: ' + err.message, true); } finally { showUploading(btn, false); } }

// ---------- Categories ----------
async function renderCategories() { const el = document.getElementById('categoryList'); if (!categories.length) { el.innerHTML = '<div class="empty-state"><i class="fas fa-folder-open"></i><p>Nenhuma categoria</p></div>'; return; } el.innerHTML = categories.map(c => `<div class="cat-row"><span><i class="fas fa-folder" style="color:var(--accent);margin-right:8px"></i>${escapeHtml(c.nome)}</span><div class="cat-row-actions"><input type="text" class="dash-input" id="subcatInput_${c.id}" placeholder="Adicionar subcategoria" style="min-width:180px;margin-right:6px"><button class="icon-btn" onclick="addSubcategory('${c.id}')" title="Adicionar subcategoria"><i class="fas fa-plus"></i></button><button class="icon-btn danger" onclick="deleteCategory('${c.id}')" title="Excluir"><i class="fas fa-trash"></i></button></div></div>`).join(''); }

async function loadCategories() { try { let all = []; let from = 0; while (true) { const { data, error } = await db.from(SUPABASE_CATEGORIES_TABLE).select('*').order('id', { ascending: true }).range(from, from + 499); if (error) throw error; if (!data || !data.length) break; all = all.concat(data); if (data.length < 500) break; from += 500; } try { const { data: subs } = await db.from(SUPABASE_SUBCATEGORIES_TABLE).select('*').order('id', { ascending: true }); all = all.map(c => ({ ...c, subcategorias: (subs || []).filter(s => s.categoria === c.nome).map(s => s.nome) })); } catch (e) { console.error('Subcats:', e); } categories = all; } catch (e) { console.error('Erro ao carregar categorias:', e); categories = []; } }

async function addCategory() { const input = document.getElementById('newCategoryName'); const name = input.value.trim(); if (!name) { toast('Digite um nome', true); return; } const { error } = await db.from(SUPABASE_CATEGORIES_TABLE).insert({ nome: name }); if (error) { toast('Erro: ' + error.message, true); return; } input.value = ''; await loadCategories(); renderCategories(); toast('Categoria adicionada'); }
async function deleteCategory(id) { const c = categories.find(x => String(x.id) === String(id)); if (!c) return; if (!confirm('Excluir a categoria "' + c.nome + '"?')) return; const { error } = await db.from(SUPABASE_CATEGORIES_TABLE).delete().eq('id', id); if (error) { toast('Erro: ' + error.message, true); return; } await loadCategories(); renderCategories(); toast('Categoria excluída'); }
async function addSubcategory(catId) { const c = categories.find(x => String(x.id) === String(catId)); if (!c) return; const input = document.getElementById('subcatInput_' + catId); const name = input.value.trim(); if (!name) { toast('Digite a subcategoria', true); return; } const { error } = await db.from(SUPABASE_SUBCATEGORIES_TABLE).insert({ nome: name, categoria: c.nome }); if (error) { toast('Erro: ' + error.message, true); return; } await loadCategories(); renderCategories(); toast('Subcategoria adicionada'); }

// ---------- Clients ----------
async function loadClients() { try { let all = []; let from = 0; while (true) { const { data, error } = await db.from(SUPABASE_CLIENTS_TABLE).select(CLIENT_SELECT).order('razao_social', { ascending: true }).range(from, from + 499); if (error) throw error; if (!data || !data.length) break; all = all.concat(data); if (data.length < 500) break; from += 500; } clients = all; } catch (e) { console.error('Erro ao carregar clientes:', e); clients = []; } }

function renderClients() { const search = document.getElementById('clientSearch').value.trim().toLowerCase(); let list = clients; if (search) list = list.filter(c => (c.razao_social || '').toLowerCase().includes(search) || (c.cnpj || '').toLowerCase().includes(search) || (c.email || '').toLowerCase().includes(search)); const el = document.getElementById('clientList'); if (!list.length) { el.innerHTML = '<div class="empty-state"><i class="fas fa-users"></i><p>Nenhum cliente cadastrado</p></div>'; return; } el.innerHTML = list.map(c => `<div class="client-item"><div class="client-info"><div class="client-name">${escapeHtml(c.razao_social)} ${c.senha_trocada || !c.senha ? '' : '<span class="pw-default-badge">senha padrão</span>'}</div><div class="client-meta"><span><i class="fas fa-envelope"></i>${escapeHtml(c.email || '')}</span>${c.cnpj ? `<span><i class="fas fa-building"></i>${escapeHtml(formatCnpj(c.cnpj))}</span>` : ''}${c.telefone ? `<span><i class="fas fa-phone"></i>${escapeHtml(c.telefone)}</span>` : ''}</div></div><div class="client-actions"><button class="icon-btn" onclick="openClientModal('${c.id}')" title="Editar"><i class="fas fa-pen"></i></button><button class="icon-btn danger" onclick="deleteClient('${c.id}')" title="Excluir"><i class="fas fa-trash"></i></button></div></div>`).join(''); }

function openClientModal(id) { const c = id ? clients.find(x => String(x.id) === String(id)) : null; document.getElementById('clientModalTitle').textContent = c ? 'Editar Cliente' : 'Novo Cliente'; document.getElementById('clientId').value = c ? c.id : ''; document.getElementById('clRazao').value = c ? c.razao_social : ''; document.getElementById('clCnpj').value = c ? (c.cnpj || '') : ''; document.getElementById('clEmail').value = c ? (c.email || '') : ''; document.getElementById('clTelefone').value = c ? (c.telefone || '') : ''; document.getElementById('clSenha').value = ''; const hint = document.getElementById('clSenhaHint'); if (!c) { hint.textContent = 'Se deixar em branco, a senha será o CNPJ somente com números.'; } else { hint.textContent = 'Deixe em branco para manter a senha atual. Senha padrão usada no cadastro: ' + (cnpjDigits(c.cnpj) || '—'); } document.getElementById('clTrocarSenha').checked = c ? !!c.senha_trocada : false; document.getElementById('clientModal').classList.add('open'); }
function closeClientModal() { document.getElementById('clientModal').classList.remove('open'); }

async function saveClient(e) { e.preventDefault(); try { const id = document.getElementById('clientId').value; const razao = document.getElementById('clRazao').value.trim(); const cnpj = document.getElementById('clCnpj').value.trim(); const email = document.getElementById('clEmail').value.trim().toLowerCase(); const telefone = document.getElementById('clTelefone').value.trim(); const manualSenha = document.getElementById('clSenha').value; const forceTroca = document.getElementById('clTrocarSenha').checked; if (!razao || !email) { toast('Preencha razão social e email', true); return; } const cnpjDV = cnpj && cnpj.replace(/\D/g, ''); if (cnpjDV) { const duplicado = clients.some(c => String(c.id) !== String(id) && c.cnpj && c.cnpj.replace(/\D/g, '') === cnpjDV); if (duplicado) { toast('Já existe um cliente com este CNPJ', true); return; } } const isNew = !id; const payload = { razao_social: razao, cnpj, email, telefone, updated_at: new Date().toISOString() }; if (isNew) { const pw = manualSenha || cnpjDigits(cnpj); if (!pw) { toast('Informe uma senha ou preencha o CNPJ', true); return; } payload.senha = await sha256Hex(pw); payload.senha_trocada = forceTroca || !manualSenha; } else { if (manualSenha) payload.senha = await sha256Hex(manualSenha); payload.senha_trocada = forceTroca; } let error; if (id) { const r = await db.from(SUPABASE_CLIENTS_TABLE).update(payload).eq('id', id); error = r.error; } else { const r = await db.from(SUPABASE_CLIENTS_TABLE).insert(payload); error = r.error; } if (error) { if (/duplicate|unique|clientes_email|23505/i.test(error.message)) { toast('Já existe um cliente com este email', true); } else { toast('Erro: ' + error.message, true); } return; } closeClientModal(); await loadClients(); renderClients(); toast(id ? 'Cliente atualizado' : 'Cliente cadastrado'); } catch (err) { console.error('saveClient error:', err); toast('Erro ao salvar', true); } }

async function deleteClient(id) { const c = clients.find(x => String(x.id) === String(id)); if (!c) return; if (!confirm('Excluir o cliente "' + c.razao_social + '"?')) return; const { error } = await db.from(SUPABASE_CLIENTS_TABLE).delete().eq('id', id); if (error) { toast('Erro: ' + error.message, true); return; } await loadClients(); renderClients(); toast('Cliente excluído'); }

function renderVisits() {
    const el = document.getElementById('visitList');
    const info = document.getElementById('visitCountInfo');
    if (!el || !clients.length) { if (el) el.innerHTML = '<div class="empty-state"><i class="fas fa-calendar-check"></i><p>Nenhum cliente cadastrado</p></div>'; return; }
    const cutoff = Date.now() - 45 * 86400000;
    const lastBuy = {};
    quotes.filter(q => q.status === 'concluido').forEach(q => {
        const key = String((q.email || q.nome_cliente || '') + '|').toLowerCase();
        if (!key || key === '|') return;
        const t = new Date(q.created_at).getTime();
        if (!(key in lastBuy) || t > lastBuy[key]) lastBuy[key] = t;
    });
    const list = clients.filter(c => {
        const keys = [String(c.email || '').toLowerCase(), String(c.razao_social || '').toLowerCase()];
        let bought = false, lastT = 0;
        keys.forEach(k => { if (!k) return; if (k in lastBuy) { bought = true; if (lastBuy[k] > lastT) lastT = lastBuy[k]; } });
        if (!bought) return false;
        return lastT < cutoff;
    });
    const search = document.getElementById('visitSearch').value.trim().toLowerCase();
    if (search) { const filtered = list.filter(c => (c.razao_social || '').toLowerCase().includes(search) || (c.email || '').toLowerCase().includes(search) || (c.cnpj || '').toLowerCase().includes(search)); list.length = 0; list.push(...filtered); }
    if (info) info.textContent = list.length + (list.length === 1 ? ' cliente para visita' : ' clientes para visita');
    if (!list.length) { el.innerHTML = '<div class="empty-state"><i class="fas fa-check-circle"></i><p>Nenhum cliente precisa de visita. Todos compraram nos últimos 45 dias ou nunca compraram.</p></div>'; return; }
    el.innerHTML = list.sort((a, b) => {
        const la = (function (c) { const keys = [String(c.email || '').toLowerCase(), String(c.razao_social || '').toLowerCase()]; let t = 0; keys.forEach(k => { if (k && k in lastBuy && lastBuy[k] > t) t = lastBuy[k]; }); return t; })(a);
        const lb = (function (c) { const keys = [String(c.email || '').toLowerCase(), String(c.razao_social || '').toLowerCase()]; let t = 0; keys.forEach(k => { if (k && k in lastBuy && lastBuy[k] > t) t = lastBuy[k]; }); return t; })(b);
        return la - lb;
    }).map(c => {
        const keys = [String(c.email || '').toLowerCase(), String(c.razao_social || '').toLowerCase()];
        let lastT = 0; keys.forEach(k => { if (k && k in lastBuy && lastBuy[k] > lastT) lastT = lastBuy[k]; });
        const days = Math.floor((Date.now() - lastT) / 86400000);
        const phone = c.telefone ? String(c.telefone).replace(/\D/g, '') : '';
        const wa = phone ? `href="https://wa.me/55${phone}?text=${encodeURIComponent('Olá! Vimos que já faz ' + days + ' dias desde sua última compra. Queremos agendar uma visita para apresentar as novas condições.')}" target="_blank"` : 'disabled';
        return `<div class="client-item"><div class="client-info"><div class="client-name">${escapeHtml(c.razao_social)}</div><div class="client-meta"><span><i class="fas fa-envelope"></i>${escapeHtml(c.email || '')}</span>${c.cnpj ? `<span><i class="fas fa-building"></i>${escapeHtml(formatCnpj(c.cnpj))}</span>` : ''}${c.telefone ? `<span><i class="fas fa-phone"></i>${escapeHtml(c.telefone)}</span>` : ''}<span class="visit-days"><i class="fas fa-clock"></i>${days} dias sem comprar</span></div></div><div class="client-actions"><a class="btn btn-primary btn-sm" ${wa} title="Agendar visita"><i class="fab fa-whatsapp"></i> Agendar Visita</a></div></div>`;
    }).join('');
}

// ---------- Prioridade por frequência ----------
function renderVisitFrequencia() {
    const el = document.getElementById('visitFreqList');
    const empty = document.getElementById('visitFreqEmpty');
    if (!el || !clients.length) { if (empty) empty.style.display = ''; return; }
    const buyDates = {};
    quotes.filter(q => q.status === 'concluido').forEach(q => {
        const keys = [String((q.email || '') + '|').toLowerCase(), String((q.nome_cliente || '') + '|').toLowerCase()];
        keys.forEach(k => { if (!k || k === '|') return; if (!buyDates[k]) buyDates[k] = []; buyDates[k].push(new Date(q.created_at).getTime()); });
    });
    Object.keys(buyDates).forEach(k => buyDates[k].sort((a, b) => a - b));
    const rows = [];
    clients.forEach(c => {
        const keys = [String((c.email || '') + '|').toLowerCase(), String((c.razao_social || '') + '|').toLowerCase()];
        const dates = [];
        keys.forEach(k => { if (buyDates[k]) buyDates[k].forEach(t => dates.push(t)); });
        if (dates.length < 2) return;
        dates.sort((a, b) => a - b);
        let sum = 0, count = 0;
        for (let i = 1; i < dates.length; i++) { const gap = (dates[i] - dates[i - 1]) / 86400000; if (gap > 0) { sum += gap; count++; } }
        if (!count) return;
        const avgInterval = sum / count;
        const last = dates[dates.length - 1];
        const days = Math.floor((Date.now() - last) / 86400000);
        const ratio = days / avgInterval;
        let badge, cls;
        if (ratio >= 3) { badge = 'Alta'; cls = 'prio-high'; }
        else if (ratio >= 2) { badge = 'Média'; cls = 'prio-mid'; }
        else { badge = 'Baixa'; cls = 'prio-low'; }
        rows.push({ c, days, avgInterval, ratio, badge, cls });
    });
    if (!rows.length) { if (el) el.innerHTML = ''; if (empty) empty.style.display = ''; return; }
    if (empty) empty.style.display = 'none';
    el.innerHTML = rows.sort((a, b) => b.ratio - a.ratio).map(r => {
        const c = r.c;
        const phone = c.telefone ? String(c.telefone).replace(/\D/g, '') : '';
        const wa = phone ? `href="https://wa.me/55${phone}?text=${encodeURIComponent('Olá! Notamos que você costuma comprar a cada ' + Math.round(r.avgInterval) + ' dias e já faz ' + r.days + ' dias. Queremos agendar uma visita para repor o estoque com novas condições.')}" target="_blank"` : 'disabled';
        return `<div class="client-item"><div class="client-info"><div class="client-name">${escapeHtml(c.razao_social)} <span class="prio-badge ${r.cls}">${r.badge}</span></div><div class="client-meta"><span><i class="fas fa-envelope"></i>${escapeHtml(c.email || '')}</span>${c.cnpj ? `<span><i class="fas fa-building"></i>${escapeHtml(formatCnpj(c.cnpj))}</span>` : ''}<span><i class="fas fa-repeat"></i>compra a cada ~${Math.round(r.avgInterval)} dias</span><span class="visit-days"><i class="fas fa-clock"></i>${r.days} dias sem comprar</span></div></div><div class="client-actions"><a class="btn btn-primary btn-sm" ${wa} title="Agendar visita"><i class="fab fa-whatsapp"></i> Agendar Visita</a></div></div>`;
    }).join('');
}

// ---------- Manual quote ----------
function openQuoteModal() { document.getElementById('quoteForm').reset(); const cl = document.getElementById('mqClientList'); if (cl) cl.innerHTML = clients.map(c => `<option value="${escapeHtml(c.razao_social)}">${escapeHtml(c.cnpj || c.email || '')}</option>`).join(''); const container = document.getElementById('mqItems'); if (container) container.innerHTML = ''; addQuoteItem(); updateQuoteTotal(); document.getElementById('quoteModal').classList.add('open'); }
function closeQuoteModal() { document.getElementById('quoteModal').classList.remove('open'); }

function addQuoteItem() { const container = document.getElementById('mqItems'); const empty = document.getElementById('mqItemsEmpty'); const row = document.createElement('div'); row.className = 'quote-item'; row.innerHTML = `<div class="qi-product"><input type="text" class="qi-code qiData" placeholder="Código..." autocomplete="off"><div class="qi-code-list"></div></div><div class="qi-product"><input type="text" class="qi-search qiData" placeholder="Produto..." autocomplete="off"><div class="qi-list"></div></div><input type="number" class="qi-qty qiData" value="1" min="1" step="1"><span class="qi-sub qiData"></span><button type="button" class="icon-btn danger" title="Remover item"><i class="fas fa-trash"></i></button>`; const codeInput = row.querySelector('.qi-code'); const searchInput = row.querySelector('.qi-search'); const qtyInput = row.querySelector('.qi-qty'); const subEl = row.querySelector('.qi-sub'); const codeList = row.querySelector('.qi-code-list'); const listEl = row.querySelector('.qi-list'); const selProduct = { id: null, nome: '', codigo: '', preco: 0, unidade: '' }; function fillFields() { codeInput.value = selProduct.codigo || ''; searchInput.value = selProduct.nome || ''; } function updateSub() { const qty = parseInt(qtyInput.value) || 1; subEl.textContent = selProduct.id ? formatPrice(selProduct.preco * qty) : ''; updateQuoteTotal(); } function selectProduct(p) { selProduct.id = p.id; selProduct.nome = p.nome; selProduct.codigo = p.codigo; selProduct.preco = Number(p.preco) || 0; selProduct.unidade = p.unidade || ''; row.dataset.codigo = p.codigo || ''; row.dataset.preco = String(Number(p.preco) || 0); fillFields(); codeList.classList.remove('open'); listEl.classList.remove('open'); updateSub(); } let debT; searchInput.addEventListener('input', () => { selProduct.id = null; clearTimeout(debT); debT = setTimeout(() => { const t = searchInput.value.trim().toLowerCase(); listEl.innerHTML = ''; if (!t) { listEl.classList.remove('open'); updateSub(); return; } const matches = products.filter(p => p.visivel !== false && ((p.nome || '').toLowerCase().includes(t) || (p.codigo || '').toLowerCase().includes(t) || (p.marca || '').toLowerCase().includes(t) || ((p.palavraschave || []).join(' ').toLowerCase().includes(t)))).slice(0, 30); matches.forEach(p => { const opt = document.createElement('div'); opt.className = 'qi-opt'; opt.innerHTML = `<strong>${escapeHtml(p.nome || '')}</strong> <small>#${escapeHtml(p.codigo || '—')} · ${escapeHtml(p.marca || '')} · ${formatPrice(p.preco)}</small>`; opt.addEventListener('mousedown', (ev) => { ev.preventDefault(); selectProduct(p); }); listEl.appendChild(opt); }); if (matches.length) listEl.classList.add('open'); else listEl.classList.remove('open'); }, 180); }); let debC; codeInput.addEventListener('input', () => { selProduct.id = null; if (codeInput.classList.contains('resolved')) codeInput.classList.remove('resolved'); clearTimeout(debC); debC = setTimeout(() => { const t = codeInput.value.trim().toLowerCase(); codeList.innerHTML = ''; if (!t) { codeList.classList.remove('open'); updateSub(); return; } const matches = products.filter(p => p.visivel !== false && (p.codigo || '').toLowerCase().includes(t)).slice(0, 20); matches.forEach(p => { const opt = document.createElement('div'); opt.className = 'qi-opt'; opt.innerHTML = `<strong>#${escapeHtml(p.codigo || '')}</strong> <small>${escapeHtml(p.nome || '')} · ${formatPrice(p.preco)}</small>`; opt.addEventListener('mousedown', (ev) => { ev.preventDefault(); selectProduct(p); }); codeList.appendChild(opt); }); if (matches.length) codeList.classList.add('open'); else codeList.classList.remove('open'); }, 150); }); codeInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); const c = codeInput.value.trim().toLowerCase(); codeList.innerHTML = ''; codeList.classList.remove('open'); if (!c) return; const exact = products.find(p => p.visivel !== false && String(p.codigo || '').toLowerCase() === c); if (exact) { selectProduct(exact); codeInput.classList.add('resolved'); } else { const partial = products.filter(p => p.visivel !== false && (p.codigo || '').toLowerCase().includes(c)); if (partial.length === 1) { selectProduct(partial[0]); codeInput.classList.add('resolved'); } else { searchInput.focus(); } } } }); searchInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); qtyInput.focus(); } }); document.addEventListener('click', (ev) => { if (!listEl.contains(ev.target) && ev.target !== searchInput) listEl.classList.remove('open'); if (!codeList.contains(ev.target) && ev.target !== codeInput) codeList.classList.remove('open'); }); qtyInput.addEventListener('input', updateSub); const delBtn = row.querySelector('.icon-btn'); delBtn.addEventListener('click', () => { row.remove(); if (!container.children.length) addQuoteItem(); updateQuoteTotal(); }); container.appendChild(row); if (empty) empty.classList.add('hidden'); codeInput.focus(); }

function updateQuoteTotal() { let total = 0; document.querySelectorAll('#mqItems .quote-item').forEach(row => { const qty = parseInt(row.querySelector('.qi-qty').value) || 1; const sub = row.querySelector('.qi-sub').textContent; const v = parseFloat(String(sub).replace('R$', '').replace(/\./g, '').replace(',', '.')) || 0; total += v; }); const disp = document.getElementById('mqTotalDisplay'); if (disp) disp.textContent = formatPrice(total); }

function collectQuoteItems() { const itens = []; document.querySelectorAll('#mqItems .quote-item').forEach(row => { const nome = (row.querySelector('.qi-search').value || '').trim(); const qty = parseInt(row.querySelector('.qi-qty').value) || 1; const subText = row.querySelector('.qi-sub').textContent; if (!nome || !subText) return; const sub = parseFloat(String(subText).replace('R$', '').replace(/\./g, '').replace(',', '.')) || 0; const unit = qty ? (sub / qty) : 0; itens.push({ nome, codigo: row.dataset.codigo || '', quantidade: qty, preco: Number(row.dataset.preco) || unit, subtotal: sub }); }); return itens; }

function editQuote(id) { const q = quotes.find(x => String(x.id) === String(id)); if (!q) return; document.getElementById('quoteForm').reset(); document.getElementById('mqEditId').value = q.id; const cl = document.getElementById('mqClientList'); if (cl) cl.innerHTML = clients.map(c => `<option value="${escapeHtml(c.razao_social)}">${escapeHtml(c.cnpj || c.email || '')}</option>`).join(''); const container = document.getElementById('mqItems'); if (container) container.innerHTML = ''; (q.itens || []).forEach(it => { addQuoteItem(); const lastRow = container.lastElementChild; if (lastRow) { lastRow.querySelector('.qi-search').value = it.nome || ''; lastRow.querySelector('.qi-qty').value = it.quantidade || 1; lastRow.querySelector('.qi-code').value = it.codigo || ''; lastRow.dataset.codigo = it.codigo || ''; lastRow.dataset.preco = String(Number(it.preco) || 0); lastRow.querySelector('.qi-sub').textContent = formatPrice((Number(it.preco) || 0) * (it.quantidade || 1)); } }); updateQuoteTotal(); document.getElementById('mqName').value = q.nome_cliente || ''; document.getElementById('mqPhone').value = q.telefone || ''; document.getElementById('mqPayment').value = q.pagamento || ''; document.getElementById('mqObs').value = ''; document.querySelector('#quoteModal h3').textContent = 'Editar Orçamento'; document.getElementById('quoteModal').classList.add('open'); }

function closeQuoteModal() { document.getElementById('quoteModal').classList.remove('open'); document.getElementById('mqEditId').value = ''; document.querySelector('#quoteModal h3').textContent = 'Novo Orçamento Manual'; }

async function saveManualQuote(e) { e.preventDefault(); const editId = document.getElementById('mqEditId').value; const isEdit = !!editId; const nome = document.getElementById('mqName').value.trim(); const tel = document.getElementById('mqPhone').value.trim().replace(/\D/g, ''); const pagamento = document.getElementById('mqPayment').value; const obs = document.getElementById('mqObs').value.trim(); const itens = collectQuoteItems(); const total = itens.reduce((s, i) => s + i.subtotal, 0); if (!nome) { toast('Preencha o nome do cliente', true); return; } if (!itens.length) { toast('Adicione ao menos um produto', true); return; } let email = ''; const foundClient = clients.find(c => c && c.razao_social && c.razao_social.toLowerCase() === nome.toLowerCase()); if (foundClient) email = foundClient.email || ''; if (obs) itens.push({ nome: 'Observações: ' + obs, quantidade: 1, subtotal: 0 }); const payload = { nome_cliente: nome, telefone: tel, email, itens, total, pagamento, updated_at: new Date().toISOString() }; if (!isEdit) { payload.codigo_cliente = 'C-' + String(Math.floor(1000 + Math.random() * 9000)); payload.codigo_retirada = String(Math.floor(1000 + Math.random() * 9000)); payload.status = 'recebido'; payload.status_entrega = 'pendente'; } let error; if (isEdit) { const r = await db.from(SUPABASE_QUOTES_TABLE).update(payload).eq('id', editId); error = r.error; } else { const r = await db.from(SUPABASE_QUOTES_TABLE).insert(payload).select(); error = r.error; } if (error) { toast('Erro: ' + error.message, true); return; } closeQuoteModal(); await loadQuotes(); renderQuotes(); toast(isEdit ? 'Orçamento atualizado' : 'Orçamento criado'); }

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.dash-nav-item[data-view]').forEach(item => { item.addEventListener('click', (e) => { e.preventDefault(); switchView(item.dataset.view); }); });
    document.getElementById('dashMenuToggle').addEventListener('click', () => { document.getElementById('dashSidebar').classList.toggle('open'); });
    document.getElementById('logoutBtn').addEventListener('click', (e) => { e.preventDefault(); if (confirm('Deseja realmente sair?')) { localStorage.removeItem(AUTH_KEY); window.location.href = 'login.html'; } });
    document.querySelectorAll('.chart-tab').forEach(tab => { tab.addEventListener('click', () => { document.querySelectorAll('.chart-tab').forEach(t => t.classList.remove('active')); tab.classList.add('active'); currentChartPeriod = tab.dataset.period; buildQuoteChart(currentChartPeriod); renderTopClients(); }); });
    document.getElementById('statusFilter').addEventListener('change', renderQuotes);
    const qSearch = document.getElementById('quoteSearch'); let qDeb; qSearch.addEventListener('input', () => { clearTimeout(qDeb); qDeb = setTimeout(renderQuotes, 250); });
    document.getElementById('btnNewQuote').addEventListener('click', openQuoteModal);
    document.getElementById('mqName').addEventListener('change', () => { const nome = document.getElementById('mqName').value.trim().toLowerCase(); const c = clients.find(x => x && x.razao_social && x.razao_social.toLowerCase() === nome); const tel = document.getElementById('mqPhone'); if (c && tel) tel.value = c.telefone || ''; });
    document.getElementById('quoteModalClose').addEventListener('click', closeQuoteModal);
    document.getElementById('quoteCancel').addEventListener('click', closeQuoteModal);
    document.getElementById('mqAddItem').addEventListener('click', addQuoteItem);
    document.getElementById('quoteForm').addEventListener('submit', saveManualQuote);
    document.getElementById('quoteDetailClose').addEventListener('click', () => { document.getElementById('quoteDetailModal').classList.remove('open'); });
    document.getElementById('btnNewProduct').addEventListener('click', () => openProductModal(null));
    document.getElementById('productModalClose').addEventListener('click', closeProductModal);
    document.getElementById('productCancel').addEventListener('click', closeProductModal);
    document.getElementById('productForm').addEventListener('submit', saveProduct);
    const pSearch = document.getElementById('productSearch'); let pDeb; pSearch.addEventListener('input', () => { clearTimeout(pDeb); pDeb = setTimeout(renderProducts, 250); });
    document.getElementById('prodPromocao').addEventListener('change', (e) => { document.getElementById('promoPriceField').style.display = e.target.checked ? '' : 'none'; });
    document.getElementById('btnAddCategory').addEventListener('click', addCategory);
    document.getElementById('newCategoryName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addCategory(); } });
    document.getElementById('btnNewClient').addEventListener('click', () => openClientModal(null));
    document.getElementById('clientModalClose').addEventListener('click', closeClientModal);
    document.getElementById('clientCancel').addEventListener('click', closeClientModal);
    document.getElementById('clientForm').addEventListener('submit', saveClient);
    const cSearch = document.getElementById('clientSearch'); let cDeb; cSearch.addEventListener('input', () => { clearTimeout(cDeb); cDeb = setTimeout(renderClients, 250); });
    const vSearch = document.getElementById('visitSearch'); let vDeb; if (vSearch) vSearch.addEventListener('input', () => { clearTimeout(vDeb); vDeb = setTimeout(renderVisits, 250); });
    const zone = document.getElementById('imgUploadZone'); const fileInput = document.getElementById('imgFileInput');
    zone.addEventListener('click', () => fileInput.click());
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('dragover'); handleFiles(e.dataTransfer.files); });
    fileInput.addEventListener('change', (e) => { handleFiles(e.target.files); fileInput.value = ''; });
    function handleFiles(files) { const imgs = Array.from(files).filter(f => f.type.startsWith('image/')); if (!imgs.length) { toast('Selecione imagens', true); return; } if ((pendingUploads.length + imgs.length) > 5) { toast('Máximo de 5 imagens', true); return; } pendingUploads.push(...imgs); imgs.forEach(f => { const url = URL.createObjectURL(f); const wrap = document.getElementById('imgPreviews'); wrap.innerHTML += `<div class="img-preview"><img src="${url}" alt=""><span class="img-pending" style="position:absolute;bottom:0;left:0;right:0;font-size:0.55rem;background:rgba(0,0,0,0.6);text-align:center">a enviar</span></div>`; }); }
    // ===== Auto logout após 5 min inatividade =====
    let inactivityTimer;
    const INACTIVITY_LIMIT = 5 * 60 * 1000; // 5 min

    function resetInactivityTimer() {
        clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(() => {
            localStorage.removeItem(AUTH_KEY);
            window.location.href = 'login.html';
        }, INACTIVITY_LIMIT);
    }

    ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(evt => {
        document.addEventListener(evt, resetInactivityTimer, { passive: true });
    });
    resetInactivityTimer(); // inicia timer
    // ============================================

    init();
});

async function init() { try { await Promise.all([loadProducts(), loadCategories(), loadQuotes(), loadClients()]); } catch (e) { console.error(e); } renderOverview(); updatePendingBadge(); switchView('dashboard'); }