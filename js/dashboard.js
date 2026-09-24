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
let currentChartGroup = 'java';
let mqLine = 'java';
let chartQuotesInstance = null;
let chartPaymentsInstance = null;

const STATUS_FLOW = ['recebido', 'analise', 'aprovado', 'concluido', 'cancelado'];
const STATUS_NEXT = { recebido: 'analise', analise: 'aprovado', aprovado: 'concluido', concluido: 'recebido', entregue: 'concluido' };
const QUOTE_SELECT = 'id, nome_cliente, telefone, email, codigo_cliente, codigo_retirada, itens, total, pagamento, status, status_entrega, linha, created_at';
const PRODUCT_SELECT = 'id, codigo, nome, marca, categoria, subcategoria, preco, unidade, descricao, palavraschave, imagens, video, visivel, estoque, isdestaque, ispromocao, precopromocional, somente_orcamento, linha, created_at, updated_at';
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

function setCurrentGroup(group) {
    currentChartGroup = group;
    document.querySelectorAll('[data-group]').forEach(btn => btn.classList.toggle('active', btn.dataset.group === group));
    // Re-render current view with new group filter
    const activeView = document.querySelector('.dash-view:not([style*="display: none"])')?.id?.replace('view-', '') || 'dashboard';
    switchView(activeView);
}

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
    if (view === 'agendar') { renderAgenda(); renderVisitLeads(); renderVisitFrequencia(); }
    if (view === 'dashboard') renderOverview();
    document.getElementById('dashSidebar').classList.remove('open');
}

// Make setCurrentGroup globally accessible for group tabs
window.setCurrentGroup = setCurrentGroup;

// ---------- Charts ----------
const centerDoughnutText = {
    id: 'centerDoughnutText',
    afterDraw(chart) {
        if (chart.config.type !== 'doughnut') return;
        const { ctx, chartArea } = chart;
        const cx = (chartArea.left + chartArea.right) / 2;
        const cy = (chartArea.top + chartArea.bottom) / 2;
        const total = chart.data.datasets[0].data.reduce((a, b) => a + b, 0);
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = "700 22px 'Chakra Petch', sans-serif";
        ctx.fillStyle = '#14121c';
        ctx.fillText(String(total), cx, cy - 10);
        ctx.font = "500 10px 'Inter', sans-serif";
        ctx.fillStyle = '#9a93a8';
        ctx.fillText('unidades vendidas', cx, cy + 12);
        ctx.restore();
    }
};
Chart.register(centerDoughnutText);

function getQuotesInPeriod(period, group = currentChartGroup) {
    const now = new Date();
    let since;
    if (period === 'today') { since = new Date(now.getFullYear(), now.getMonth(), now.getDate()); }
    else if (period === 'month') { since = new Date(now.getFullYear(), now.getMonth(), 1); }
    else { const d = parseInt(period) || 7; since = new Date(now.getTime() - d * 86400000); }
    return quotes.filter(q => new Date(q.created_at) >= since && q.linha === group);
}

function buildQuoteChart(period) {
    const el = document.getElementById('chartQuotes');
    const empty = document.getElementById('chartQuotesEmpty');
    const periodQ = getQuotesInPeriod(period);
    if (empty) empty.style.display = periodQ.length ? 'none' : '';

const labels = [];
    const dataConcluido = [];
    const buckets = [];
    if (period === 'today') {
        for (let h = 8; h <= 20; h += 2) {
            const lo = new Date(); lo.setHours(h, 0, 0, 0);
            const hi = new Date(lo.getTime() + 7200000);
            buckets.push({ label: h + 'h', start: lo, end: hi });
        }
    } else if (period === 'month') {
        const now = new Date();
        const dayCount = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        for (let i = 0; i < dayCount; i++) {
            const d = new Date(now.getFullYear(), now.getMonth(), i + 1);
            buckets.push({ label: d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }), start: new Date(d.getFullYear(), d.getMonth(), d.getDate()), end: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1) });
        }
    } else {
        const days = parseInt(period) || 7;
        const step = days > 14 ? days / 12 : 1;
        let cur = days;
        while (cur > 0) {
            const next = Math.max(0, Math.round(cur - step));
            const loBase = new Date(); loBase.setDate(loBase.getDate() - (cur - 1));
            const lo = new Date(loBase.getFullYear(), loBase.getMonth(), loBase.getDate());
            const hiBase = new Date(); hiBase.setDate(hiBase.getDate() - next);
            const hi = new Date(hiBase.getFullYear(), hiBase.getMonth(), hiBase.getDate() + 1);
            const fLabel = lo.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
            const lLabel = new Date(hi.getTime() - 86400000).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
            buckets.push({ label: fLabel === lLabel ? fLabel : fLabel + ' → ' + lLabel, start: lo, end: hi });
            cur = next;
        }
    }
    buckets.forEach(bkt => {
        labels.push(bkt.label);
        dataConcluido.push(periodQ.filter(q => { const d = new Date(q.created_at); return d >= bkt.start && d < bkt.end && q.status === 'concluido'; }).length);
    });
    if (chartQuotesInstance) { chartQuotesInstance.destroy(); chartQuotesInstance = null; }
    if (!el) return;

    const gradientApproved = el.getContext('2d').createLinearGradient(0, 0, 0, 320);
    gradientApproved.addColorStop(0, 'rgba(0,255,163,0.25)');
    gradientApproved.addColorStop(0.6, 'rgba(0,229,255,0.08)');
    gradientApproved.addColorStop(1, 'rgba(46,213,115,0)');

    chartQuotesInstance = new Chart(el, {
        type: 'line',
        data: { 
            labels, 
            datasets: [
                { 
                    label: 'Orçamentos Concluídos', 
                    data: dataConcluido, 
                    fill: true,
                    tension: 0.45,
                    borderColor: '#00ffa3',
                    backgroundColor: gradientApproved,
                    borderWidth: 3,
                    pointBackgroundColor: '#fff',
                    pointBorderColor: '#00ffa3',
                    pointBorderWidth: 2,
                    pointRadius: 4,
                    pointHoverRadius: 7,
                    pointHoverBackgroundColor: '#4f6bff',
                    pointHoverBorderColor: '#fff',
                    pointHoverBorderWidth: 2,
                    hoverBorderColor: '#4f6bff',
                    hoverBorderWidth: 3
                }
            ]},
        options: {
            responsive: true,
            maintainAspectRatio: false,
            devicePixelRatio: 2,
            interaction: { intersect: false, mode: 'index' },
            animation: { duration: 900, easing: 'easeOutQuart' },
            layout: { padding: { top: 18, right: 16, bottom: 8, left: 8 } },
            plugins: {
                legend: {
                    position: 'top',
                    align: 'end',
                    labels: {
                        font: { family: 'Chakra Petch', weight: '600', size: 12 },
                        color: '#4b4453',
                        padding: 20,
                        usePointStyle: true,
                        pointStyle: 'rectRounded',
                        boxWidth: 10,
                        boxHeight: 10
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(11,6,20,0.96)',
                    titleFont: { family: 'Chakra Petch', size: 13, weight: '700' },
                    titleColor: '#fff',
                    bodyFont: { family: 'Chakra Petch', size: 12, weight: '500' },
                    bodyColor: '#e9e4f5',
                    padding: 14,
                    cornerRadius: 12,
                    displayColors: true,
                    boxPadding: 6,
                    borderColor: 'rgba(0,229,255,0.4)',
                    borderWidth: 1.5,
                    callbacks: {
                        label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y} orçamentos`
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false, drawBorder: false },
                    ticks: {
                        font: { family: 'Chakra Petch', size: 11, weight: '600' },
                        color: '#6b6477',
                        padding: 10
                    },
                    border: { display: false }
                },
                y: {
                    beginAtZero: true,
                    precision: 0,
                    grid: {
                        color: 'rgba(168,85,247,0.10)',
                        drawBorder: false,
                        drawTicks: false
                    },
                    ticks: {
                        font: { family: 'Chakra Petch', size: 11 },
                        color: '#6b6477',
                        padding: 10,
                        callback: (value) => Number.isInteger(value) ? value : null
                    },
                    border: { display: false }
                }
            }
        }
    });
}

function buildPaymentChart() {
    const el = document.getElementById('chartPayments');
    const empty = document.getElementById('chartPaymentsEmpty');
    const map = {};
    getQuotesInPeriod(currentChartPeriod).filter(q => q.status === 'concluido' && q.linha === currentChartGroup).forEach(q => {
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

    const colors = ['#a855f7', '#00e5ff', '#ff2fe6', '#00ffa3', '#4f6bff', '#ffa502', '#ff5c8a', '#22d3ee', '#a3e635', '#f43f5e'];
    const total = data.reduce((a, b) => a + b, 0);

    chartPaymentsInstance = new Chart(el, {
        type: 'doughnut',
        data: { 
            labels, 
            datasets: [{ 
                data, 
                backgroundColor: colors.slice(0, labels.length),
                borderWidth: 3,
                borderColor: '#fff',
                hoverOffset: 12,
                hoverBorderColor: '#fff',
                hoverBorderWidth: 3
            }] 
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            devicePixelRatio: 2,
            cutout: '70%',
            animation: { 
                animateRotate: true, 
                animateScale: true,
                duration: 1000,
                easing: 'easeOutQuart'
            },
            layout: { padding: 20 },
            plugins: {
                legend: {
                    position: 'right',
                    align: 'center',
                    labels: {
                        font: { family: 'Chakra Petch', size: 11, weight: '600' },
                        color: '#4b4453',
                        padding: 16,
                        usePointStyle: true,
                        pointStyle: 'circle',
                        boxWidth: 9,
                        boxHeight: 9,
                        generateLabels: (chart) => {
                            const data = chart.data;
                            if (data.labels.length && data.datasets.length) {
                                return data.labels.map((label, i) => {
                                    const value = data.datasets[0].data[i];
                                    const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                                    return {
                                        text: `${label} — ${percentage}%`,
                                        fillStyle: chart.data.datasets[0].backgroundColor[i],
                                        strokeStyle: 'transparent',
                                        lineWidth: 0,
                                        pointStyle: 'circle',
                                        hidden: false,
                                        index: i
                                    };
                                });
                            }
                            return [];
                        }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(11,6,20,0.96)',
                    titleFont: { family: 'Chakra Petch', size: 13, weight: '700' },
                    titleColor: '#fff',
                    bodyFont: { family: 'Chakra Petch', size: 12, weight: '500' },
                    bodyColor: '#e9e4f5',
                    padding: 14,
                    cornerRadius: 12,
                    displayColors: true,
                    boxPadding: 6,
                    borderColor: 'rgba(255,47,230,0.4)',
                    borderWidth: 1.5,
                    callbacks: {
                        label: (ctx) => {
                            const value = ctx.parsed;
                            const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                            return ` ${ctx.label}: ${value} unid. (${percentage}%)`;
                        }
                    }
                }
            }
        }
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
    const periodQ = getQuotesInPeriod(currentChartPeriod).filter(q => q.status === 'concluido' && q.linha === currentChartGroup);
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
    const groupProducts = products.filter(p => p.linha === currentChartGroup);
    const sold = {};
    getQuotesInPeriod(currentChartPeriod).filter(q => q.status === 'concluido' && q.linha === currentChartGroup).forEach(q => {
        (Array.isArray(q.itens) ? q.itens : []).forEach(i => {
            const k = String((i.codigo || i.nome || '')).trim().toLowerCase();
            if (!k) return;
            sold[k] = (sold[k] || 0) + (Number(i.quantidade) || 0);
        });
    });
    const rows = groupProducts.map(p => {
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
    const groupProducts = products.filter(p => p.linha === currentChartGroup);
    if (!groupProducts.length) { el.innerHTML = '<div class="empty-state"><i class="fas fa-box-open"></i><p>Nenhum produto no catálogo.</p></div>'; return; }
    const sold = {};
    getQuotesInPeriod(currentChartPeriod).filter(q => q.status === 'concluido' && q.linha === currentChartGroup).forEach(q => {
        (Array.isArray(q.itens) ? q.itens : []).forEach(i => {
            const k = String((i.codigo || i.nome || '')).trim().toLowerCase();
            if (!k) return;
            sold[k] = (sold[k] || 0) + (Number(i.quantidade) || 0);
        });
    });
    const rows = groupProducts.map(p => {
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
const GROUP_LABELS = { java: 'Java', dymar: 'Dymar' };

function updateChartTitles() {
    const g = GROUP_LABELS[currentChartGroup] || 'Java';
    const qTitle = document.getElementById('chartQuotesTitle');
    const pTitle = document.getElementById('chartPaymentsTitle');
    if (qTitle) qTitle.innerHTML = '<i class="fas fa-chart-bar"></i> Pedidos por período (' + g + ')';
    if (pTitle) pTitle.innerHTML = '<i class="fas fa-chart-pie"></i> Vendas por categoria (' + g + ')';
}

async function renderOverview() {
    updateChartTitles();
    const groupQuotes = getQuotesInPeriod(currentChartPeriod);
    document.getElementById('metricQuotes').textContent = groupQuotes.length;
    document.getElementById('metricSales').textContent = groupQuotes.filter(q => q.status === 'concluido').length;
    const totalSold = groupQuotes.filter(q => q.status === 'concluido').reduce((s, q) => s + (Number(q.total) || 0), 0);
    document.getElementById('metricSold').textContent = formatPrice(totalSold);
    const soldClients = new Set(groupQuotes.filter(q => q.status === 'concluido').map(q => q.email || q.nome_cliente));
    document.getElementById('metricClients').textContent = soldClients.size;
    const soldItems = groupQuotes.filter(q => q.status === 'concluido').reduce((s, q) => s + (Array.isArray(q.itens) ? q.itens.reduce((a, i) => a + (Number(i.quantidade) || 0), 0) : 0), 0);
    document.getElementById('metricSoldItems').textContent = soldItems;

    buildQuoteChart(currentChartPeriod);
    buildPaymentChart();
    renderTopClients();
    renderTopSellers();
    renderLowSellers();
}

// ---------- Quotes ----------
function statusLabel(s) { const map = { recebido: 'Recebido', analise: 'Em análise', aprovado: 'Aprovado', entregue: 'Entregue', concluido: 'Concluído', cancelado: 'Cancelado' }; return map[s] || s; }

async function loadQuotes() {
    try { let all = []; let from = 0; while (true) { const { data, error } = await db.from(SUPABASE_QUOTES_TABLE).select(QUOTE_SELECT).order('created_at', { ascending: false }).range(from, from + 499); if (error) throw error; if (!data || !data.length) break; all = all.concat(data); if (data.length < 500) break; from += 500; } quotes = all.map(q => { q.linha = q.linha || 'java'; return q; }); } catch (e) { console.error('Erro ao carregar orçamentos:', e); quotes = []; }
    updatePendingBadge();
}

function updatePendingBadge() { const badge = document.getElementById('pendingQuotesBadge'); if (!badge) return; const n = quotes.filter(q => q.status === 'recebido').length; badge.textContent = n; badge.style.display = n > 0 ? '' : 'none'; }

function renderQuotes() {
    const statusFilter = document.getElementById('statusFilter').value;
    const search = document.getElementById('quoteSearch').value.trim().toLowerCase();
    let list = quotes.filter(q => q.linha === currentChartGroup);
    if (statusFilter !== 'all') list = list.filter(q => q.status === statusFilter);
    if (search) list = list.filter(q => (q.nome_cliente || '').toLowerCase().includes(search) || (q.email || '').toLowerCase().includes(search) || (q.telefone || '').toLowerCase().includes(search) || (q.codigo_cliente || '').toLowerCase().includes(search));
    const el = document.getElementById('quoteList');
    if (!list.length) { el.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><p>Nenhum orçamento encontrado</p></div>'; return; }
    el.innerHTML = list.map(q => `
        <div class="quote-card">
            <div class="quote-card-row">
                <div class="quote-main-info">
                    <span class="quote-code-badge">#${escapeHtml(q.codigo_cliente || q.id)}</span>
                    <span class="quote-card-name">${escapeHtml(getQuoteClientName(q))}</span>
                    <span class="quote-meta-icons">
                        ${q.email ? `<span title="Email"><i class="fas fa-envelope"></i>${escapeHtml(q.email)}</span>` : ''}
                        ${q.telefone ? `<span title="Telefone"><i class="fas fa-phone"></i>${escapeHtml(q.telefone)}</span>` : ''}
                        <span title="Data"><i class="fas fa-clock"></i>${formatDate(q.created_at)}</span>
                        ${q.pagamento ? `<span title="Prazo"><i class="fas fa-calendar-alt"></i>${escapeHtml(q.pagamento)}</span>` : ''}
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
        <div class="qd-row"><span>Cliente</span><span>${escapeHtml(getQuoteClientName(q))}</span></div>
        <div class="qd-row"><span>Email</span><span>${escapeHtml(q.email || '')}</span></div>
        <div class="qd-row"><span>Telefone</span><span>${escapeHtml(q.telefone || '')}</span></div>
        <div class="qd-row"><span>Código Cliente</span><span>${escapeHtml(q.codigo_cliente || '')}</span></div>
        
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
    doc.setTextColor(tc[0], tc[1], tc[2]); doc.setFont('helvetica', 'bold'); doc.setFontSize(19); doc.text('ORÇAMENTO N° ' + String(q.codigo_cliente || q.id || ''), pageW / 2, 20, { align: 'center' });
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
    const fileName = 'orcamento-' + (q.codigo_cliente || q.id) + '-' + (q.nome_cliente ? q.nome_cliente.replace(/[^\w\s]/g, '').trim().replace(/\s+/g, '_') : 'cliente') + '.pdf'; doc.save(fileName); toast('PDF do orçamento baixado.'); }

// ---------- Products ----------
async function loadProducts() { try { let all = []; let from = 0; while (true) { const { data, error } = await db.from(SUPABASE_PRODUCTS_TABLE).select(PRODUCT_SELECT).order('id', { ascending: true }).range(from, from + 499); if (error) throw error; if (!data || !data.length) break; all = all.concat(data); if (data.length < 500) break; from += 500; } products = all; } catch (e) { console.error('Erro ao carregar produtos:', e); products = []; } }

function renderProducts() { const search = document.getElementById('productSearch').value.trim().toLowerCase(); let list = products.filter(p => p.linha === currentChartGroup); if (search) list = list.filter(p => (p.nome || '').toLowerCase().includes(search) || (p.codigo || '').toLowerCase().includes(search) || (p.marca || '').toLowerCase().includes(search) || (p.categoria || '').toLowerCase().includes(search)); const tbody = document.getElementById('productTableBody'); if (!list.length) { tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--text-muted)">Nenhum produto encontrado</td></tr>'; return; } tbody.innerHTML = list.map(p => { const img = (p.imagens && p.imagens.length) ? p.imagens[0] : ''; const imgHtml = img ? `<img class="prod-img" src="${escapeHtml(img)}" alt="" onerror="this.onerror=null;this.style.display='none'">` : '<div class="prod-no-img"><i class="fas fa-image"></i></div>'; const linhaLabel = p.linha === 'java' ? '<span class="linha-badge linha-java">Java</span>' : '<span class="linha-badge linha-dymar">Dymar</span>'; return `<tr><td data-label="Imagem">${imgHtml}</td><td data-label="Código"><span class="prod-code">${escapeHtml(p.codigo || '—')}</span></td><td data-label="Produto"><div class="prod-name">${escapeHtml(p.nome)}</div><div class="prod-code">${escapeHtml(p.marca || '')}</div></td><td data-label="Categoria">${escapeHtml(p.categoria || '')}</td><td data-label="Linha">${linhaLabel}</td><td data-label="Preço" class="price-cell">${formatPrice(p.preco)}${p.ispromocao && p.precopromocional > 0 ? `<br><small style="color:var(--warning)">Promo: ${formatPrice(p.precopromocional)}</small>` : ''}</td><td data-label="Estoque">${p.estoque}</td><td data-label="Visível"><button class="toggle ${p.visivel ? 'on' : ''}" onclick="toggleVisibility('${p.id}')" title="Visível no catálogo"></button></td><td data-label="Ações"><div style="display:flex;gap:6px"><button class="icon-btn" onclick="openProductModal('${p.id}')" title="Editar"><i class="fas fa-pen"></i></button><button class="icon-btn danger" onclick="deleteProduct('${p.id}')" title="Excluir"><i class="fas fa-trash"></i></button></div></td></tr>`; }).join(''); }

async function toggleVisibility(id) { const p = products.find(x => String(x.id) === String(id)); if (!p) return; const newVal = !p.visivel; const { error } = await db.from(SUPABASE_PRODUCTS_TABLE).update({ visivel: newVal, updated_at: new Date().toISOString() }).eq('id', id); if (error) { toast('Erro: ' + error.message, true); return; } p.visivel = newVal; renderProducts(); toast(newVal ? 'Produto visível no catálogo' : 'Produto oculto do catálogo'); }
async function deleteProduct(id) { if (!confirm('Excluir este produto?')) return; const { error } = await db.from(SUPABASE_PRODUCTS_TABLE).delete().eq('id', id); if (error) { toast('Erro: ' + error.message, true); return; } products = products.filter(x => String(x.id) !== String(id)); renderProducts(); toast('Produto excluído'); }

// ---------- Product modal ----------
let editingImages = [];
function fillCategorySelects() { const catSel = document.getElementById('prodCategoria'); catSel.innerHTML = '<option value="">Sem categoria</option>' + categories.map(c => `<option value="${escapeHtml(c.nome)}">${escapeHtml(c.nome)}</option>`).join(''); fillSubcatSelect(); }
function fillSubcatSelect() { const cat = document.getElementById('prodCategoria').value; const subSel = document.getElementById('prodSubcategoria'); const current = subSel.value; const subs = categories.length && cat ? categories.filter(c => c.nome === cat).flatMap(c => c.subcategorias || []) : []; subSel.innerHTML = '<option value="">Sem subcategoria</option>' + subs.map(s => `<option value="${escapeHtml(s)}" ${s === current ? 'selected' : ''}>${escapeHtml(s)}</option>`).join(''); }

function openProductModal(id) { editingImages = []; pendingUploads = []; document.getElementById('productForm').reset(); document.getElementById('promoPriceField').style.display = 'none'; fillCategorySelects(); const title = document.getElementById('productModalTitle'); const isNew = (id == null); if (isNew) { title.textContent = 'Novo Produto'; document.getElementById('productId').value = ''; document.getElementById('prodEstoque').value = 0; document.getElementById('prodUnidade').value = 'UN'; document.getElementById('prodLinha').value = 'java'; } else { const p = products.find(x => String(x.id) === String(id)); if (!p) return; title.textContent = 'Editar — ' + (p.codigo || p.nome); document.getElementById('productId').value = p.id; document.getElementById('prodCodigo').value = p.codigo || ''; document.getElementById('prodNome').value = p.nome || ''; document.getElementById('prodMarca').value = p.marca || ''; document.getElementById('prodCategoria').value = p.categoria || ''; fillSubcatSelect(); document.getElementById('prodSubcategoria').value = p.subcategoria || ''; document.getElementById('prodLinha').value = p.linha || 'java'; document.getElementById('prodPreco').value = priceInput(p.preco); document.getElementById('prodEstoque').value = p.estoque || 0; document.getElementById('prodUnidade').value = p.unidade || 'UN'; document.getElementById('prodDescricao').value = p.descricao || ''; document.getElementById('prodKeywords').value = (Array.isArray(p.palavraschave) ? p.palavraschave : []).join(', '); document.getElementById('prodDestaque').checked = !!p.isdestaque; document.getElementById('prodPromocao').checked = !!p.ispromocao; document.getElementById('prodSomenteOrcamento').checked = !!p.somente_orcamento; document.getElementById('prodPrecoPromo').value = priceInput(p.precopromocional); if (p.ispromocao) document.getElementById('promoPriceField').style.display = ''; editingImages = Array.isArray(p.imagens) ? p.imagens.slice() : []; renderImgPreviews(); fillImgUrlInputs(); } document.getElementById('productModal').classList.add('open'); }
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
async function fileToWebP(file, width) { return new Promise((resolve, reject) => { console.log('[fileToWebP] Converting:', file.name, 'width:', width); const reader = new FileReader(); reader.onload = (e) => { const img = new Image(); img.onload = () => { console.log('[fileToWebP] Image loaded:', img.width, 'x', img.height); const canvas = document.createElement('canvas'); let w = img.width, h = img.height; if (w > width) { h = Math.round(h * width / w); w = width; } canvas.width = w; canvas.height = h; canvas.getContext('2d').drawImage(img, 0, 0, w, h); canvas.toBlob(blob => { if (blob) { console.log('[fileToWebP] WebP blob created:', blob.size, 'bytes'); resolve(blob); } else { reject(new Error('falha ao criar WebP')); } }, 'image/webp', 0.8); }; img.onerror = () => reject(new Error('imagem inválida')); img.src = e.target.result; }; reader.onerror = () => reject(new Error('leitura falhou')); reader.readAsDataURL(file); }); }
async function uploadToR2(webpMain, webpThumb, hash) { console.log('[uploadToR2] Uploading:', hash); if (typeof R2_WORKER_URL === 'undefined' || !R2_WORKER_URL || typeof R2_PUBLIC_BASE_URL === 'undefined' || !R2_PUBLIC_BASE_URL) throw new Error('R2 não configurado: verifique js/r2-config.js'); const form = new FormData(); form.append('main', webpMain, hash + '.webp'); form.append('thumb', webpThumb, hash + '_thumb.webp'); form.append('hash', hash); const headers = {}; if (typeof R2_WORKER_SECRET !== 'undefined' && R2_WORKER_SECRET) headers['Authorization'] = 'Bearer ' + R2_WORKER_SECRET; console.log('[uploadToR2] Sending to:', R2_WORKER_URL + '/upload'); const res = await fetch(R2_WORKER_URL + '/upload', { method: 'POST', body: form, headers }); console.log('[uploadToR2] Response status:', res.status); if (!res.ok) { let msg = 'Falha no upload (' + res.status + ')'; try { const d = await res.json(); if (d.error) msg += ': ' + d.error; } catch (e) {} throw new Error(msg); } const result = { main: R2_PUBLIC_BASE_URL + '/produtos/' + hash + '.webp', thumb: R2_PUBLIC_BASE_URL + '/produtos/' + hash + '_thumb.webp' }; console.log('[uploadToR2] Success:', result); return result; }
function showUploading(btn, on) { btn.disabled = on; if (on) { btn.dataset.orig = btn.innerHTML; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...'; } else { if (btn.dataset.orig) btn.innerHTML = btn.dataset.orig; } }

async function saveProduct(e) { e.preventDefault(); const btn = document.getElementById('productSubmit'); showUploading(btn, true); try { const id = document.getElementById('productId').value; const uploadedNew = []; if (pendingUploads && pendingUploads.length) { console.log('[saveProduct] Processing', pendingUploads.length, 'pending uploads'); for (const f of pendingUploads) { try { console.log('[saveProduct] Processing file:', f.name, f.type, f.size); const buffer = await f.arrayBuffer(); console.log('[saveProduct] Buffer size:', buffer.byteLength); const hash = await hashFileBuffer(buffer); console.log('[saveProduct] Hash:', hash); const [main, thumb] = await Promise.all([fileToWebP(f, 1200), fileToWebP(f, 400)]); console.log('[saveProduct] WebP conversion done, main:', main.size, 'thumb:', thumb.size); const uploaded = await uploadToR2(main, thumb, hash); console.log('[saveProduct] Upload success:', uploaded); uploadedNew.push(uploaded.main); } catch (uploadErr) { console.error('Erro upload R2:', uploadErr); toast('Falha ao enviar imagem para R2: ' + uploadErr.message, true); showUploading(btn, false); return; } } pendingUploads = []; } const urlImgs = []; for (let i = 0; i < 5; i++) { const v = document.getElementById('prodImg' + (i + 1)).value.trim(); if (v) urlImgs.push(v); } editingImages = urlImgs.length ? urlImgs : []; if (uploadedNew.length) editingImages = editingImages.concat(uploadedNew).slice(0, 5); const palavraschave = document.getElementById('prodKeywords').value.split(',').map(s => s.trim()).filter(Boolean); const isp = document.getElementById('prodPromocao').checked; const somenteOrcamento = document.getElementById('prodSomenteOrcamento').checked; const payload = { codigo: document.getElementById('prodCodigo').value.trim() || null, nome: document.getElementById('prodNome').value.trim(), marca: document.getElementById('prodMarca').value.trim(), categoria: document.getElementById('prodCategoria').value, subcategoria: document.getElementById('prodSubcategoria').value || null, preco: parsePrice(document.getElementById('prodPreco').value), unidade: document.getElementById('prodUnidade').value, descricao: document.getElementById('prodDescricao').value, palavraschave, imagens: editingImages, estoque: parseInt(document.getElementById('prodEstoque').value) || 0, isdestaque: document.getElementById('prodDestaque').checked, ispromocao: isp, precopromocional: isp ? parsePrice(document.getElementById('prodPrecoPromo').value) : 0, somente_orcamento: somenteOrcamento, linha: document.getElementById('prodLinha').value, visivel: true, updated_at: new Date().toISOString() }; let error; if (id) { const r = await db.from(SUPABASE_PRODUCTS_TABLE).update(payload).eq('id', id); error = r.error; } else { const r = await db.from(SUPABASE_PRODUCTS_TABLE).insert(payload); error = r.error; } if (error) throw new Error(error.message); closeProductModal(); await loadProducts(); renderProducts(); toast(r2NotConfigured ? 'Produto salvo, mas imagens não enviadas (R2 ainda não configurado)' : 'Produto salvo com sucesso'); } catch (err) { console.error(err); toast('Erro: ' + err.message, true); } finally { showUploading(btn, false); } }

// ---------- Importação de Produtos (CSV) ----------
let importRows = [];

function importNormalizeHeader(h) { return String(h || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, ''); }

function parseCSVText(text) {
    const rows = [];
    let field = '', record = [], inQuotes = false;
    const pushRow = () => { if (record.some(f => String(f).trim() !== '')) rows.push(record); record = []; };
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
            else field += ch;
        } else if (ch === '"') { inQuotes = true; }
        else if (ch === ',') { record.push(field); field = ''; }
        else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; record.push(field); field = ''; pushRow(); }
        else field += ch;
    }
    record.push(field);
    pushRow();
    return rows;
}

function importPrice(str) {
    if (str == null) return 0;
    let s = String(str).replace(/[R$\s]/g, '');
    if (!s) return 0;
    if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
    else if (s.includes(',')) s = s.replace(',', '.');
    else if (s.includes('.')) {
        const parts = s.split('.');
        const last = parts[parts.length - 1];
        if (last.length === 3 && s.replace(/\./g, '').length > 3) s = s.replace(/\./g, '');
    }
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
}

function crc32(buf) {
    let table = crc32.table;
    if (!table) {
        table = crc32.table = new Int32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            table[n] = c;
        }
    }
    let c = 0 ^ -1;
    for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ table[(c ^ buf[i]) & 0xFF];
    return (c ^ -1) >>> 0;
}
function xlsxUtf8(s) { return new TextEncoder().encode(s); }
function buildXlsxZip(entries) {
    const parts = [], central = [];
    let offset = 0;
    const now = new Date();
    const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xFFFF;
    const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;
    for (const e of entries) {
        const nameBytes = xlsxUtf8(e.name);
        const data = e.data;
        const crc = crc32(data);
        const local = new Uint8Array(30 + nameBytes.length + data.length);
        const dv = new DataView(local.buffer);
        dv.setUint32(0, 0x04034b50, true);
        dv.setUint16(4, 20, true);
        dv.setUint16(6, 0x0800, true);
        dv.setUint16(8, 0, true);
        dv.setUint16(10, dosTime, true);
        dv.setUint16(12, dosDate, true);
        dv.setUint32(14, crc, true);
        dv.setUint32(18, data.length, true);
        dv.setUint32(22, data.length, true);
        dv.setUint16(26, nameBytes.length, true);
        dv.setUint16(28, 0, true);
        local.set(nameBytes, 30);
        local.set(data, 30 + nameBytes.length);
        parts.push(local);
        const cen = new Uint8Array(46 + nameBytes.length);
        const cdv = new DataView(cen.buffer);
        cdv.setUint32(0, 0x02014b50, true);
        cdv.setUint16(4, 20, true);
        cdv.setUint16(6, 20, true);
        cdv.setUint16(8, 0x0800, true);
        cdv.setUint16(10, 0, true);
        cdv.setUint16(12, dosTime, true);
        cdv.setUint16(14, dosDate, true);
        cdv.setUint32(16, crc, true);
        cdv.setUint32(20, data.length, true);
        cdv.setUint32(24, data.length, true);
        cdv.setUint16(28, nameBytes.length, true);
        cdv.setUint32(42, offset, true);
        cen.set(nameBytes, 46);
        central.push({ bytes: cen, offset });
        offset += local.length;
    }
    let centralSize = 0;
    central.forEach(c => centralSize += c.bytes.length);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, central.length, true);
    ev.setUint16(10, central.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);
    const out = new Uint8Array(offset + centralSize + 22);
    let p = 0;
    parts.forEach(b => { out.set(b, p); p += b.length; });
    central.forEach(c => { out.set(c.bytes, p); p += c.bytes.length; });
    out.set(eocd, p);
    return out;
}
function downloadImportTemplate() {
    const col = (ref, txt) => `<c r="${ref}" t="inlineStr"><is><t>${txt}</t></is></c>`;
    const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<cols><col min="1" max="1" width="10"/><col min="2" max="2" width="10"/><col min="3" max="3" width="32"/><col min="4" max="4" width="16"/><col min="5" max="5" width="10"/><col min="6" max="6" width="12"/></cols>
<sheetData>
<row r="1">${col('A1', 'Código')}${col('B1', 'Unidade')}${col('C1', 'Nome do Produto')}${col('D1', 'Marca')}${col('E1', 'Linha')}${col('F1', 'Preço')}</row>
<row r="2">${col('A2', '001')}${col('B2', 'UN')}${col('C2', 'Exemplo de Produto')}${col('D2', 'Exemplo')}${col('E2', 'Java')}<c r="F2"><v>12.5</v></c></row>
<row r="3">${col('A3', '002')}${col('B3', 'UN')}${col('C3', 'Exemplo de Produto 2')}${col('D3', 'Exemplo')}${col('E3', 'Dymar')}<c r="F3"><v>12.5</v></c></row>
</sheetData>
</worksheet>`;
    const entries = [
        { name: '[Content_Types].xml', data: xlsxUtf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`) },
        { name: '_rels/.rels', data: xlsxUtf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`) },
        { name: 'xl/workbook.xml', data: xlsxUtf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Produtos" sheetId="1" r:id="rId1"/></sheets>
</workbook>`) },
        { name: 'xl/_rels/workbook.xml.rels', data: xlsxUtf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`) },
        { name: 'xl/styles.xml', data: xlsxUtf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="1"><font><sz val="11"/><color rgb="FF000000"/><name val="Calibri"/></font></fonts>
<fills count="1"><fill><patternFill patternType="none"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`) },
        { name: 'xl/worksheets/sheet1.xml', data: xlsxUtf8(sheet) }
    ];
    const zip = buildXlsxZip(entries);
    const blob = new Blob([zip], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'template-produtos.xlsx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
}

function findZipEOCD(view) {
    const len = view.byteLength;
    for (let i = len - 22; i >= Math.max(0, len - 22 - 65535); i--) {
        if (view.getUint32(i, true) === 0x06054b50) return i;
    }
    return -1;
}

async function readXlsxRows(file) {
    if (typeof DecompressionStream === 'undefined') throw new Error('navegador não suporta leitura de .xlsx (atualize o navegador)');
    const buf = await file.arrayBuffer();
    const view = new DataView(buf);
    const eocd = findZipEOCD(view);
    if (eocd < 0) throw new Error('arquivo .xlsx inválido');
    const count = view.getUint16(eocd + 10, true);
    let p = view.getUint32(eocd + 16, true);
    const dec = new TextDecoder();
    const entries = {};
    for (let i = 0; i < count; i++) {
        const method = view.getUint16(p + 10, true);
        const compSize = view.getUint32(p + 20, true);
        const nameLen = view.getUint16(p + 28, true);
        const extraLen = view.getUint16(p + 30, true);
        const commentLen = view.getUint16(p + 32, true);
        const localOffset = view.getUint32(p + 42, true);
        entries[dec.decode(new Uint8Array(buf, p + 46, nameLen))] = { method, compSize, localOffset };
        p += 46 + nameLen + extraLen + commentLen;
    }
    const readEntry = async (name) => {
        const en = entries[name];
        if (!en) return null;
        const nameLen = view.getUint16(en.localOffset + 26, true);
        const extraLen = view.getUint16(en.localOffset + 28, true);
        const start = en.localOffset + 30 + nameLen + extraLen;
        const bytes = new Uint8Array(buf, start, en.compSize);
        if (en.method === 0) return dec.decode(bytes);
        if (en.method === 8) {
            const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
            return dec.decode(await new Response(stream).arrayBuffer());
        }
        throw new Error('compressão não suportada');
    };
    const sheetName = Object.keys(entries).find(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
    if (!sheetName) throw new Error('planilha não encontrada no arquivo');
    const sheetXml = await readEntry(sheetName);
    const ssXml = await readEntry('xl/sharedStrings.xml');
    let shared = [];
    if (ssXml) {
        const sdoc = new DOMParser().parseFromString(ssXml, 'application/xml');
        shared = Array.from(sdoc.getElementsByTagName('si')).map(si => Array.from(si.getElementsByTagName('t')).map(t => t.textContent).join(''));
    }
    const doc = new DOMParser().parseFromString(sheetXml, 'application/xml');
    const rows = [];
    Array.from(doc.getElementsByTagName('row')).forEach(rowEl => {
        const rIdx = Math.max(0, parseInt(rowEl.getAttribute('r') || (rows.length + 1), 10) - 1);
        const arr = [];
        Array.from(rowEl.getElementsByTagName('c')).forEach(c => {
            const ref = c.getAttribute('r') || '';
            const letters = ref.replace(/[0-9]/g, '');
            const colIdx = letters ? (letters.split('').reduce((a, ch) => a * 26 + (ch.charCodeAt(0) - 64), 0) - 1) : arr.length;
            const t = c.getAttribute('t');
            let val = '';
            if (t === 'inlineStr') val = Array.from(c.getElementsByTagName('t')).map(x => x.textContent).join('');
            else { const v = c.getElementsByTagName('v')[0]; val = v ? (t === 's' ? (shared[parseInt(v.textContent, 10)] || '') : v.textContent) : ''; }
            arr[colIdx] = val;
        });
        rows[rIdx] = arr;
    });
    return rows.filter(r => Array.isArray(r) && r.some(x => String(x == null ? '' : x).trim() !== ''));
}

async function handleProductImport(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let rows;
    try {
        if (/\.xlsx$/i.test(file.name)) rows = await readXlsxRows(file);
        else rows = parseCSVText(await file.text());
    } catch (err) { console.error('import error:', err); toast('Erro ao ler arquivo: ' + err.message, true); return; }
    if (rows.length < 2) { toast('Arquivo sem dados', true); return; }
    const headers = rows[0].map(importNormalizeHeader);
    const idx = { codigo: headers.indexOf('codigo'), unidade: headers.indexOf('unidade'), nome: Math.max(headers.indexOf('nomedoproduto'), headers.indexOf('nome')), marca: headers.indexOf('marca'), linha: headers.indexOf('linha'), preco: headers.indexOf('preco') };
    if (idx.codigo < 0 || idx.nome < 0 || idx.preco < 0) { toast('Headers esperados: Código, Unidade, Nome do Produto, Marca, Linha, Preço', true); return; }
    const dataRows = rows.slice(1);
    if (dataRows.length > 500) { toast('Máximo de 500 produtos por importação', true); return; }
    const UNIDADES = ['UN', 'KG', 'MT', 'M2', 'M3', 'LT', 'PAR', 'KIT', 'CX', 'PC'];
    importRows = dataRows.map((r, originalIndex) => {
        const cell = (i) => (i >= 0 && r[i] != null ? String(r[i]).trim() : '');
        const codigo = cell(idx.codigo);
        const nome = cell(idx.nome);
        const marca = cell(idx.marca);
        const linhaRaw = cell(idx.linha).toLowerCase();
        const preco = importPrice(cell(idx.preco));
        let unidade = cell(idx.unidade).toUpperCase();
        if (!UNIDADES.includes(unidade)) unidade = 'UN';
        const linha = linhaRaw === 'java' || linhaRaw === 'dymar' ? linhaRaw : '';
        let error = '';
        if (!codigo) error = 'Código obrigatório';
        else if (products.some(p => p.codigo && String(p.codigo).toLowerCase() === codigo.toLowerCase())) error = 'Código já cadastrado';
        else if (!nome) error = 'Nome do produto obrigatório';
        else if (!linha) error = 'Linha deve ser Java ou Dymar';
        else if (!(preco > 0)) error = 'Preço inválido';
        return { codigo, unidade, nome, marca, linha, preco, originalIndex, ok: !error, error };
    });
    const seen = {};
    importRows.forEach(r => {
        const k = String(r.codigo).toLowerCase();
        if (r.ok && seen[k]) { r.ok = false; r.error = 'Código duplicado no arquivo'; }
        else if (r.ok) seen[k] = r.originalIndex;
    });
    renderImportModal();
    document.getElementById('importModal').classList.add('open');
}

function renderImportModal() {
    const ok = importRows.filter(r => r.ok).length;
    const bad = importRows.length - ok;
    document.getElementById('importSummary').innerHTML = '<span class="imp-summary-ok"><i class="fas fa-check-circle"></i> ' + ok + ' pronto(s) para importar</span><span class="imp-summary-err' + (bad ? '' : ' imp-summary-hide') + '"><i class="fas fa-exclamation-triangle"></i> ' + bad + ' com erro</span>';
    document.getElementById('importTableBody').innerHTML = importRows.map(r => `
        <tr class="${r.ok ? 'imp-row-ok' : 'imp-row-err'}">
            <td>${r.ok ? '<span class="imp-badge imp-badge-ok">OK</span>' : '<span class="imp-badge imp-badge-err">Erro</span>'}</td>
            <td>${escapeHtml(r.codigo)}</td>
            <td>${escapeHtml(r.nome)}</td>
            <td>${escapeHtml(r.marca)}</td>
            <td>${r.linha ? (r.linha === 'dymar' ? 'Dymar' : 'Java') : '-'}</td>
            <td>${formatPrice(r.preco)}</td>
            <td>${r.error ? escapeHtml(r.error) : ''}</td>
            <td>${r.ok ? `<button class="icon-btn" onclick="prefillImportRow(${r.originalIndex})" title="Abrir no formulário de produto"><i class="fas fa-pen"></i></button>` : ''}</td>
        </tr>`).join('');
}

function prefillImportRow(i) {
    const r = importRows.find(x => x.originalIndex === i);
    if (!r) return;
    openProductModal(null);
    document.getElementById('prodCodigo').value = r.codigo;
    document.getElementById('prodUnidade').value = r.unidade;
    document.getElementById('prodNome').value = r.nome;
    document.getElementById('prodMarca').value = r.marca;
    document.getElementById('prodLinha').value = r.linha;
    document.getElementById('prodPreco').value = priceInput(r.preco);
}

async function confirmImport() {
    const valid = importRows.filter(r => r.ok);
    if (!valid.length) { toast('Nenhum produto válido para importar', true); return; }
    const btn = document.getElementById('importConfirm');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Importando...';
    let imported = 0, failed = 0;
    const padraoCategoria = document.getElementById('prodCategoria') ? document.getElementById('prodCategoria').value : '';
    for (let i = 0; i < valid.length; i += 50) {
        const batch = valid.slice(i, i + 50);
        const results = await Promise.all(batch.map(async (row) => {
            const payload = { codigo: row.codigo || null, nome: row.nome, marca: row.marca || '', categoria: padraoCategoria, subcategoria: null, preco: row.preco, unidade: row.unidade, descricao: '', palavraschave: [], imagens: [], estoque: 0, isdestaque: false, ispromocao: false, precopromocional: 0, somente_orcamento: false, linha: row.linha, visivel: true, updated_at: new Date().toISOString() };
            const { error } = await db.from(SUPABASE_PRODUCTS_TABLE).insert(payload);
            if (error) failed++; else imported++;
        }));
    }
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-file-import"></i> Confirmar Importação';
    await loadProducts();
    renderProducts();
    document.getElementById('importModal').classList.remove('open');
    toast('Importação concluída: ' + imported + ' produto(s) importado(s)' + (failed ? ', ' + failed + ' com erro' : ''));
}

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

function renderVisitLeads() {
    const el = document.getElementById('visitLeadList');
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
function openQuoteModal() { document.getElementById('quoteForm').reset(); const cl = document.getElementById('mqClientList'); if (cl) cl.innerHTML = clients.map(c => `<option value="${escapeHtml(c.razao_social)}">${escapeHtml(c.cnpj || c.email || '')}</option>`).join(''); setMqLine(currentChartGroup === 'dymar' ? 'dymar' : 'java'); document.getElementById('quoteModal').classList.add('open'); }
function closeQuoteModal() { document.getElementById('quoteModal').classList.remove('open'); }

function setMqLine(line) {
    mqLine = line;
    document.querySelectorAll('#mqLineTabs .mq-line-tab').forEach(b => b.classList.toggle('active', b.dataset.mqline === line));
    const container = document.getElementById('mqItems');
    const empty = document.getElementById('mqItemsEmpty');
    if (container) container.innerHTML = '';
    if (empty) empty.classList.remove('hidden');
    addQuoteItem();
    updateQuoteTotal();
}

function addQuoteItem() { const container = document.getElementById('mqItems'); const empty = document.getElementById('mqItemsEmpty'); const row = document.createElement('div'); row.className = 'quote-item'; row.innerHTML = `<div class="qi-product"><input type="text" class="qi-code qiData" placeholder="Código..." autocomplete="off"><div class="qi-code-list"></div></div><div class="qi-product"><input type="text" class="qi-search qiData" placeholder="Produto..." autocomplete="off"><div class="qi-list"></div></div><input type="number" class="qi-qty qiData" value="1" min="1" step="1"><span class="qi-sub qiData"></span><button type="button" class="icon-btn danger" title="Remover item"><i class="fas fa-trash"></i></button>`; const codeInput = row.querySelector('.qi-code'); const searchInput = row.querySelector('.qi-search'); const qtyInput = row.querySelector('.qi-qty'); const subEl = row.querySelector('.qi-sub'); const codeList = row.querySelector('.qi-code-list'); const listEl = row.querySelector('.qi-list'); const selProduct = { id: null, nome: '', codigo: '', preco: 0, unidade: '' }; function fillFields() { codeInput.value = selProduct.codigo || ''; searchInput.value = selProduct.nome || ''; } function updateSub() { const qty = parseInt(qtyInput.value) || 1; subEl.textContent = selProduct.id ? formatPrice(selProduct.preco * qty) : ''; updateQuoteTotal(); } function selectProduct(p) { selProduct.id = p.id; selProduct.nome = p.nome; selProduct.codigo = p.codigo; selProduct.preco = Number(p.preco) || 0; selProduct.unidade = p.unidade || ''; row.dataset.codigo = p.codigo || ''; row.dataset.preco = String(Number(p.preco) || 0); fillFields(); codeList.classList.remove('open'); listEl.classList.remove('open'); updateSub(); } let debT; searchInput.addEventListener('input', () => { selProduct.id = null; clearTimeout(debT); debT = setTimeout(() => { const t = searchInput.value.trim().toLowerCase(); listEl.innerHTML = ''; if (!t) { listEl.classList.remove('open'); updateSub(); return; } const matches = products.filter(p => p.visivel !== false && p.linha === mqLine && ((p.nome || '').toLowerCase().includes(t) || (p.codigo || '').toLowerCase().includes(t) || (p.marca || '').toLowerCase().includes(t) || ((p.palavraschave || []).join(' ').toLowerCase().includes(t)))).slice(0, 30); matches.forEach(p => { const opt = document.createElement('div'); opt.className = 'qi-opt'; opt.innerHTML = `<strong>${escapeHtml(p.nome || '')}</strong> <small>#${escapeHtml(p.codigo || '—')} · ${escapeHtml(p.marca || '')} · ${formatPrice(p.preco)}</small>`; opt.addEventListener('mousedown', (ev) => { ev.preventDefault(); selectProduct(p); }); listEl.appendChild(opt); }); if (matches.length) listEl.classList.add('open'); else listEl.classList.remove('open'); }, 180); }); let debC; codeInput.addEventListener('input', () => { selProduct.id = null; if (codeInput.classList.contains('resolved')) codeInput.classList.remove('resolved'); clearTimeout(debC); debC = setTimeout(() => { const t = codeInput.value.trim().toLowerCase(); codeList.innerHTML = ''; if (!t) { codeList.classList.remove('open'); updateSub(); return; } const matches = products.filter(p => p.visivel !== false && p.linha === mqLine && (p.codigo || '').toLowerCase().includes(t)).slice(0, 20); matches.forEach(p => { const opt = document.createElement('div'); opt.className = 'qi-opt'; opt.innerHTML = `<strong>#${escapeHtml(p.codigo || '')}</strong> <small>${escapeHtml(p.nome || '')} · ${formatPrice(p.preco)}</small>`; opt.addEventListener('mousedown', (ev) => { ev.preventDefault(); selectProduct(p); }); codeList.appendChild(opt); }); if (matches.length) codeList.classList.add('open'); else codeList.classList.remove('open'); }, 150); }); codeInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); const c = codeInput.value.trim().toLowerCase(); codeList.innerHTML = ''; codeList.classList.remove('open'); if (!c) return; const exact = products.find(p => p.visivel !== false && p.linha === mqLine && String(p.codigo || '').toLowerCase() === c);
            if (exact) { selectProduct(exact); codeInput.classList.add('resolved'); } else { const partial = products.filter(p => p.visivel !== false && p.linha === mqLine && (p.codigo || '').toLowerCase().includes(c)); if (partial.length === 1) { selectProduct(partial[0]); codeInput.classList.add('resolved'); } else { searchInput.focus(); } } } }); searchInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); qtyInput.focus(); } }); document.addEventListener('click', (ev) => { if (!listEl.contains(ev.target) && ev.target !== searchInput) listEl.classList.remove('open'); if (!codeList.contains(ev.target) && ev.target !== codeInput) codeList.classList.remove('open'); }); qtyInput.addEventListener('input', updateSub); const delBtn = row.querySelector('.icon-btn'); delBtn.addEventListener('click', () => { row.remove(); if (!container.children.length) addQuoteItem(); updateQuoteTotal(); }); container.appendChild(row); if (empty) empty.classList.add('hidden'); codeInput.focus(); }

function updateQuoteTotal() { let total = 0; document.querySelectorAll('#mqItems .quote-item').forEach(row => { const qty = parseInt(row.querySelector('.qi-qty').value) || 1; const sub = row.querySelector('.qi-sub').textContent; const v = parseFloat(String(sub).replace('R$', '').replace(/\./g, '').replace(',', '.')) || 0; total += v; }); const disp = document.getElementById('mqTotalDisplay'); if (disp) disp.textContent = formatPrice(total); }

function collectQuoteItems() { const itens = []; document.querySelectorAll('#mqItems .quote-item').forEach(row => { const nome = (row.querySelector('.qi-search').value || '').trim(); const qty = parseInt(row.querySelector('.qi-qty').value) || 1; const subText = row.querySelector('.qi-sub').textContent; if (!nome || !subText) return; const sub = parseFloat(String(subText).replace('R$', '').replace(/\./g, '').replace(',', '.')) || 0; const unit = qty ? (sub / qty) : 0; itens.push({ nome, codigo: row.dataset.codigo || '', quantidade: qty, preco: Number(row.dataset.preco) || unit, subtotal: sub }); }); return itens; }

function editQuote(id) { const q = quotes.find(x => String(x.id) === String(id)); if (!q) return; document.getElementById('quoteForm').reset(); document.getElementById('mqEditId').value = q.id; mqLine = q.linha === 'dymar' ? 'dymar' : 'java'; document.querySelectorAll('#mqLineTabs .mq-line-tab').forEach(b => b.classList.toggle('active', b.dataset.mqline === mqLine)); const cl = document.getElementById('mqClientList'); if (cl) cl.innerHTML = clients.map(c => `<option value="${escapeHtml(c.razao_social)}">${escapeHtml(c.cnpj || c.email || '')}</option>`).join(''); const container = document.getElementById('mqItems'); if (container) container.innerHTML = ''; (q.itens || []).forEach(it => { addQuoteItem(); const lastRow = container.lastElementChild; if (lastRow) { lastRow.querySelector('.qi-search').value = it.nome || ''; lastRow.querySelector('.qi-qty').value = it.quantidade || 1; lastRow.querySelector('.qi-code').value = it.codigo || ''; lastRow.dataset.codigo = it.codigo || ''; lastRow.dataset.preco = String(Number(it.preco) || 0); lastRow.querySelector('.qi-sub').textContent = formatPrice((Number(it.preco) || 0) * (it.quantidade || 1)); } }); updateQuoteTotal(); document.getElementById('mqName').value = q.nome_cliente || ''; document.getElementById('mqPhone').value = q.telefone || ''; document.getElementById('mqPayment').value = q.pagamento || ''; document.getElementById('mqObs').value = ''; document.querySelector('#quoteModal h3').textContent = 'Editar Orçamento'; document.getElementById('quoteModal').classList.add('open'); }

function closeQuoteModal() { document.getElementById('quoteModal').classList.remove('open'); document.getElementById('mqEditId').value = ''; document.querySelector('#quoteModal h3').textContent = 'Novo Orçamento Manual'; }

async function saveManualQuote(e) { e.preventDefault(); const editId = document.getElementById('mqEditId').value; const isEdit = !!editId; const nome = document.getElementById('mqName').value.trim(); const tel = document.getElementById('mqPhone').value.trim().replace(/\D/g, ''); const pagamento = document.getElementById('mqPayment').value; const obs = document.getElementById('mqObs').value.trim(); const itens = collectQuoteItems(); const total = itens.reduce((s, i) => s + i.subtotal, 0); if (!nome) { toast('Preencha o nome do cliente', true); return; } if (!itens.length) { toast('Adicione ao menos um produto', true); return; } const mixed = itens.filter(i => i.codigo).map(i => products.find(p => p && p.codigo && String(p.codigo) === String(i.codigo))).filter(p => p && p.linha !== mqLine); if (mixed.length) { toast('Produtos não pertencem à linha selecionada (' + (mqLine === 'dymar' ? 'Dymar' : 'Java') + ')', true); return; } let email = ''; const foundClient = clients.find(c => c && c.razao_social && c.razao_social.toLowerCase() === nome.toLowerCase()); if (foundClient) email = foundClient.email || ''; if (obs) itens.push({ nome: 'Observações: ' + obs, quantidade: 1, subtotal: 0 }); const payload = { nome_cliente: nome, telefone: tel, email, itens, total, pagamento, linha: mqLine, updated_at: new Date().toISOString() }; if (!isEdit) { payload.codigo_cliente = 'C-' + String(Math.floor(1000 + Math.random() * 9000)); payload.codigo_retirada = String(Math.floor(1000 + Math.random() * 9000)); payload.status = 'recebido'; payload.status_entrega = 'pendente'; } let error; if (isEdit) { const r = await db.from(SUPABASE_QUOTES_TABLE).update(payload).eq('id', editId); error = r.error; } else { const r = await db.from(SUPABASE_QUOTES_TABLE).insert(payload).select(); error = r.error; } if (error) { toast('Erro: ' + error.message, true); return; } closeQuoteModal(); await loadQuotes(); renderQuotes(); toast(isEdit ? 'Orçamento atualizado' : 'Orçamento criado'); }

// ---------- Agenda de Visitas (calendário + rotas) ----------
let visits = [];
let visitCalYear = new Date().getFullYear();
let visitCalMonth = new Date().getMonth();
let visitSelectedDate = null;
const VISIT_STATUS_LABEL = { agendada: 'Agendada', realizada: 'Realizada', cancelada: 'Cancelada' };
const ROUTE_COLORS = ['#a855f7', '#00e5ff', '#ff2fe6', '#00ffa3', '#4f6bff', '#ffa502', '#ff5c8a', '#22d3ee', '#a3e635'];

function routeColor(route) {
    if (!route) return '#9a93a8';
    let h = 0;
    for (let i = 0; i < route.length; i++) h = (h * 31 + route.charCodeAt(i)) >>> 0;
    return ROUTE_COLORS[h % ROUTE_COLORS.length];
}
function dateKey(d) { const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0'); const day = String(d.getDate()).padStart(2, '0'); return y + '-' + m + '-' + day; }
function fromKey(k) { const p = String(k).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
function fmtBr(k) { const d = fromKey(k); return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }); }

async function loadVisits() {
    try {
        const { data, error } = await db.from(SUPABASE_VISITS_TABLE).select('*').order('data', { ascending: true });
        if (error) throw error;
        visits = data || [];
    } catch (e) { console.error('Erro ao carregar visitas:', e); visits = []; }
}

function agendaFiltered() {
    const f = document.getElementById('visitRouteFilter');
    const route = f ? f.value : '';
    return route ? visits.filter(v => (v.rota || '') === route) : visits.slice();
}

function renderAgenda() {
    renderCalendar();
    renderVisitList();
    renderRouteList();
}

function renderCalendar() {
    const el = document.getElementById('visitCalendar');
    if (!el) return;
    const label = document.getElementById('visitMonthLabel');
    if (label) label.textContent = new Date(visitCalYear, visitCalMonth, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    const byDate = {};
    agendaFiltered().forEach(v => { const k = v.data || ''; if (k) (byDate[k] = byDate[k] || []).push(v); });
    const first = new Date(visitCalYear, visitCalMonth, 1);
    const offset = (first.getDay() + 6) % 7;
    const dim = new Date(visitCalYear, visitCalMonth + 1, 0).getDate();
    const todayKey = dateKey(new Date());
    let html = '<div class="visit-cal-head">' + ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'].map(w => `<span>${w}</span>`).join('') + '</div><div class="visit-cal-grid">';
    for (let i = 0; i < offset; i++) html += '<span class="vc-blank"></span>';
    for (let d = 1; d <= dim; d++) {
        const k = dateKey(new Date(visitCalYear, visitCalMonth, d));
        const dayVisits = byDate[k] || [];
        const isToday = k === todayKey;
        const isSel = k === visitSelectedDate;
        html += `<div class="vc-day ${isToday ? 'today' : ''} ${isSel ? 'selected' : ''}" data-date="${k}"><span class="vc-num">${d}</span><div class="vc-dots">`;
        dayVisits.slice(0, 3).forEach(v => { html += `<span class="vc-dot" style="background:${routeColor(v.rota)}" title="${escapeHtml(v.razao_social)}"></span>`; });
        if (dayVisits.length > 3) html += `<span class="vc-more">+${dayVisits.length - 3}</span>`;
        html += '</div></div>';
    }
    html += '</div>';
    el.innerHTML = html;
    el.querySelectorAll('.vc-day').forEach(cell => {
        cell.addEventListener('click', () => { visitSelectedDate = cell.dataset.date; renderCalendar(); });
    });
}

function visitItemHtml(v, withActions) {
    const st = v.status || 'agendada';
    const doneBtn = withActions && st === 'agendada' ? `<button class="icon-btn" title="Marcar realizada" onclick="setVisitStatus('${v.id}','realizada')"><i class="fas fa-check"></i></button>` : '';
    const cancelBtn = withActions && st === 'agendada' ? `<button class="icon-btn" title="Cancelar visita" onclick="setVisitStatus('${v.id}','cancelada')"><i class="fas fa-ban"></i></button>` : '';
    const editBtn = withActions ? `<button class="icon-btn" title="Editar" onclick="openVisitModal('${v.data}','${v.id}')"><i class="fas fa-pen"></i></button>` : '';
    const delBtn = withActions ? `<button class="icon-btn danger" title="Excluir" onclick="deleteVisit('${v.id}')"><i class="fas fa-trash"></i></button>` : '';
    return `<div class="client-item visit-item" data-status="${st}" style="border-left:4px solid ${routeColor(v.rota)}">
        <div class="client-info">
            <div class="client-name">${escapeHtml(v.razao_social || '(cliente)')} <span class="visit-status visit-status-${st}">${VISIT_STATUS_LABEL[st] || st}</span></div>
            <div class="client-meta">
                <span><i class="far fa-calendar"></i>${fmtBr(v.data)}</span>
                ${v.hora ? `<span><i class="far fa-clock"></i>${escapeHtml(v.hora)}</span>` : ''}
                ${v.rota ? `<span><i class="fas fa-route"></i>${escapeHtml(v.rota)}</span>` : ''}
                ${v.telefone ? `<span><i class="fas fa-phone"></i>${escapeHtml(v.telefone)}</span>` : ''}
            </div>
            ${v.observacoes ? `<div class="visit-obs"><i class="fas fa-note-sticky"></i>${escapeHtml(v.observacoes)}</div>` : ''}
        </div>
        <div class="client-actions">${doneBtn}${cancelBtn}${editBtn}${delBtn}</div>
    </div>`;
}

function renderVisitList() {
    const el = document.getElementById('visitList');
    if (!el) return;
    const today = dateKey(new Date());
    const list = agendaFiltered().filter(v => v.status === 'agendada' && v.data >= today).sort((a, b) => (a.data + ' ' + (a.hora || '')).localeCompare(b.data + ' ' + (b.hora || '')));
    if (!list.length) { el.innerHTML = '<div class="empty-state"><i class="fas fa-calendar-check"></i><p>Nenhuma visita agendada.</p></div>'; return; }
    el.innerHTML = list.map(v => visitItemHtml(v, true)).join('');
}

function renderRouteList() {
    const el = document.getElementById('visitRouteList');
    if (!el) return;
    const byRoute = {};
    visits.filter(v => v.status === 'agendada').forEach(v => { const r = v.rota || 'Sem rota'; (byRoute[r] = byRoute[r] || []).push(v); });
    const routes = Object.keys(byRoute).sort();
    if (!routes.length) { el.innerHTML = '<div class="empty-state"><i class="fas fa-route"></i><p>Nenhuma rota criada ainda.</p></div>'; return; }
    el.innerHTML = routes.map(r => {
        const list = byRoute[r].sort((a, b) => (a.data + ' ' + (a.hora || '')).localeCompare(b.data + ' ' + (b.hora || '')));
        return `<div class="route-block" style="border-color:${routeColor(r)}">
            <div class="route-head"><span class="route-dot" style="background:${routeColor(r)}"></span><strong>${escapeHtml(r)}</strong><span class="route-count">${list.length} ${list.length === 1 ? 'visita' : 'visitas'}</span></div>
            <div class="client-list">${list.map(v => visitItemHtml(v, false)).join('')}</div>
        </div>`;
    }).join('');
}

function updateVisitRouteFilter() {
    const sel = document.getElementById('visitRouteFilter');
    if (!sel) return;
    const current = sel.value;
    const routes = [...new Set(visits.map(v => v.rota).filter(Boolean))].sort();
    sel.innerHTML = '<option value="">Todas as rotas</option>' + routes.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('');
    if (routes.includes(current)) sel.value = current;
}

function openVisitModal(date, id) {
    const v = id ? visits.find(x => String(x.id) === String(id)) : null;
    document.getElementById('visitForm').reset();
    document.getElementById('visitId').value = v ? v.id : '';
    const dl = document.getElementById('visitClientList');
    if (dl) dl.innerHTML = clients.map(c => `<option value="${escapeHtml(c.razao_social)}">${escapeHtml(c.email || '')}</option>`).join('');
    const rd = document.getElementById('visitRouteListOpts');
    if (rd) rd.innerHTML = [...new Set(visits.map(x => x.rota).filter(Boolean))].map(r => `<option value="${escapeHtml(r)}">`).join('');
    document.getElementById('visitClient').value = v ? (v.razao_social || '') : '';
    document.getElementById('visitEmail').value = v ? (v.email || '') : '';
    document.getElementById('visitPhone').value = v ? (v.telefone || '') : '';
    document.getElementById('visitDate').value = v ? (v.data || '') : (date || dateKey(new Date()));
    document.getElementById('visitTime').value = v ? (v.hora || '') : '';
    document.getElementById('visitRoute').value = v ? (v.rota || '') : '';
    document.getElementById('visitObs').value = v ? (v.observacoes || '') : '';
    document.querySelector('#visitModal h3').textContent = v ? 'Editar Visita' : 'Nova Visita';
    document.getElementById('visitModal').classList.add('open');
}
function closeVisitModal() { document.getElementById('visitModal').classList.remove('open'); }

async function saveVisit(e) {
    e.preventDefault();
    const id = document.getElementById('visitId').value;
    const nome = document.getElementById('visitClient').value.trim();
    const email = document.getElementById('visitEmail').value.trim();
    const tel = document.getElementById('visitPhone').value.trim();
    const data = document.getElementById('visitDate').value;
    const hora = document.getElementById('visitTime').value;
    const rota = document.getElementById('visitRoute').value.trim();
    const obs = document.getElementById('visitObs').value.trim();
    if (!nome || !data) { toast('Preencha cliente e data', true); return; }
    const payload = { razao_social: nome, email, telefone: tel, data, hora: hora || '', rota, observacoes: obs, updated_at: new Date().toISOString() };
    let error;
    if (id) {
        const r = await db.from(SUPABASE_VISITS_TABLE).update(payload).eq('id', id); error = r.error;
    } else {
        payload.status = 'agendada';
        const r = await db.from(SUPABASE_VISITS_TABLE).insert(payload); error = r.error;
    }
    if (error) { toast('Erro: ' + error.message, true); return; }
    closeVisitModal();
    await loadVisits();
    updateVisitRouteFilter();
    renderAgenda();
    toast(id ? 'Visita atualizada' : 'Visita agendada');
}

async function setVisitStatus(id, status) {
    const { error } = await db.from(SUPABASE_VISITS_TABLE).update({ status, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { toast('Erro: ' + error.message, true); return; }
    await loadVisits();
    renderAgenda();
    toast(VISIT_STATUS_LABEL[status] || status);
}

async function deleteVisit(id) {
    if (!confirm('Excluir esta visita?')) return;
    const { error } = await db.from(SUPABASE_VISITS_TABLE).delete().eq('id', id);
    if (error) { toast('Erro: ' + error.message, true); return; }
    await loadVisits();
    updateVisitRouteFilter();
    renderAgenda();
    toast('Visita excluída');
}

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.dash-nav-item[data-view]').forEach(item => { item.addEventListener('click', (e) => { e.preventDefault(); switchView(item.dataset.view); }); });
    document.getElementById('dashMenuToggle').addEventListener('click', () => { document.getElementById('dashSidebar').classList.toggle('open'); });
    document.getElementById('logoutBtn').addEventListener('click', (e) => { e.preventDefault(); if (confirm('Deseja realmente sair?')) { localStorage.removeItem(AUTH_KEY); window.location.href = 'login.html'; } });
    document.querySelectorAll('.chart-tab[data-period]').forEach(tab => { tab.addEventListener('click', () => { document.querySelectorAll('.chart-tab[data-period]').forEach(t => t.classList.remove('active')); tab.classList.add('active'); currentChartPeriod = tab.dataset.period; renderOverview(); }); });
document.querySelectorAll('[data-group]').forEach(tab => { tab.addEventListener('click', () => { document.querySelectorAll('[data-group]').forEach(t => t.classList.remove('active')); tab.classList.add('active'); setCurrentGroup(tab.dataset.group); }); });
    document.getElementById('statusFilter').addEventListener('change', renderQuotes);
    const qSearch = document.getElementById('quoteSearch'); let qDeb; qSearch.addEventListener('input', () => { clearTimeout(qDeb); qDeb = setTimeout(renderQuotes, 250); });
    document.getElementById('btnNewQuote').addEventListener('click', openQuoteModal);
    document.getElementById('mqName').addEventListener('change', () => { const nome = document.getElementById('mqName').value.trim().toLowerCase(); const c = clients.find(x => x && x.razao_social && x.razao_social.toLowerCase() === nome); const tel = document.getElementById('mqPhone'); if (c && tel) tel.value = c.telefone || ''; });
    document.getElementById('quoteModalClose').addEventListener('click', closeQuoteModal);
    document.getElementById('quoteCancel').addEventListener('click', closeQuoteModal);
    document.getElementById('mqAddItem').addEventListener('click', addQuoteItem);
    document.querySelectorAll('#mqLineTabs .mq-line-tab').forEach(btn => btn.addEventListener('click', () => { if (btn.dataset.mqline !== mqLine) setMqLine(btn.dataset.mqline); }));
    document.getElementById('quoteForm').addEventListener('submit', saveManualQuote);
    document.getElementById('quoteDetailClose').addEventListener('click', () => { document.getElementById('quoteDetailModal').classList.remove('open'); });
    document.getElementById('btnNewProduct').addEventListener('click', () => openProductModal(null));
    document.getElementById('btnImportProducts').addEventListener('click', () => document.getElementById('productImportFile').click());
    document.getElementById('btnImportTemplate').addEventListener('click', downloadImportTemplate);
    document.getElementById('productImportFile').addEventListener('change', handleProductImport);
    document.getElementById('importModalClose').addEventListener('click', () => document.getElementById('importModal').classList.remove('open'));
    document.getElementById('importCancel').addEventListener('click', () => document.getElementById('importModal').classList.remove('open'));
    document.getElementById('importConfirm').addEventListener('click', confirmImport);
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
    const vSearch = document.getElementById('visitSearch'); let vDeb; if (vSearch) vSearch.addEventListener('input', () => { clearTimeout(vDeb); vDeb = setTimeout(renderVisitLeads, 250); });
    document.getElementById('visitPrevMonth').addEventListener('click', () => { visitCalMonth--; if (visitCalMonth < 0) { visitCalMonth = 11; visitCalYear--; } renderCalendar(); });
    document.getElementById('visitNextMonth').addEventListener('click', () => { visitCalMonth++; if (visitCalMonth > 11) { visitCalMonth = 0; visitCalYear++; } renderCalendar(); });
    document.getElementById('visitTodayBtn').addEventListener('click', () => { const n = new Date(); visitCalYear = n.getFullYear(); visitCalMonth = n.getMonth(); visitSelectedDate = null; renderCalendar(); });
    const visitRouteFilter = document.getElementById('visitRouteFilter'); if (visitRouteFilter) visitRouteFilter.addEventListener('change', renderAgenda);
    document.getElementById('btnNewVisit').addEventListener('click', () => openVisitModal(dateKey(new Date())));
    document.getElementById('visitModalClose').addEventListener('click', closeVisitModal);
    document.getElementById('visitCancel').addEventListener('click', closeVisitModal);
    document.getElementById('visitForm').addEventListener('submit', saveVisit);
    document.getElementById('visitClient').addEventListener('change', () => {
        const nome = document.getElementById('visitClient').value.trim().toLowerCase();
        const c = clients.find(x => x && x.razao_social && x.razao_social.toLowerCase() === nome);
        if (!c) return;
        document.getElementById('visitEmail').value = c.email || '';
        document.getElementById('visitPhone').value = c.telefone || '';
    });
    const zone = document.getElementById('imgUploadZone'); const fileInput = document.getElementById('imgFileInput');
    zone.addEventListener('click', () => fileInput.click());
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('dragover'); handleFiles(e.dataTransfer.files); });
    fileInput.addEventListener('change', (e) => { handleFiles(e.target.files); fileInput.value = ''; });
    function handleFiles(files) { 
    console.log('[handleFiles] Files received:', files.length);
    const imgs = Array.from(files).filter(f => f.type.startsWith('image/')); 
    console.log('[handleFiles] Valid images:', imgs.length);
    if (!imgs.length) { toast('Selecione imagens válidas', true); return; } 
    if ((pendingUploads.length + imgs.length) > 5) { toast('Máximo de 5 imagens', true); return; } 
    pendingUploads.push(...imgs); 
    imgs.forEach(f => { 
        const url = URL.createObjectURL(f); 
        const wrap = document.getElementById('imgPreviews'); 
        wrap.innerHTML += `<div class="img-preview"><img src="${url}" alt=""><span class="img-pending" style="position:absolute;bottom:0;left:0;right:0;font-size:0.55rem;background:rgba(0,0,0,0.6);text-align:center">a enviar</span></div>`; 
    }); 
}
    // ===== Auto logout após 5 min inatividade =====
    let inactivityTimer;
    const INACTIVITY_LIMIT = 15 * 60 * 1000; // 15 min

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

async function init() { 
    if (!localStorage.getItem(AUTH_KEY)) { 
        window.location.href = 'login.html'; 
        return; 
    }
    try { await Promise.all([loadProducts(), loadCategories(), loadQuotes(), loadClients()]); } catch (e) { console.error(e); } renderOverview(); updatePendingBadge(); switchView('dashboard'); }