// ============================================================
// Java Distribuidora - Publico (Catalogo + Carrinho + Orcamento)
// ============================================================

const WHATSAPP_NUMBER = '5512997780047';
const WHATSAPP_DISPLAY = '(12) 99778-0047';
const CART_KEY = 'jv2_cart';
const CLIENT_SESSION_KEY = 'jv2_client_session';

// ============ Util ============
function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function formatPrice(v) {
    return 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function getThumbUrl(url) {
    if (!url || !url.includes('.webp')) return url;
    return url.replace('.webp', '_thumb.webp');
}
function showToast(msg, isError) {
    const t = document.createElement('div');
    t.className = 'toast-bar' + (isError ? ' error' : '');
    t.innerHTML = (isError ? '<i class="fas fa-exclamation-circle"></i>' : '<i class="fas fa-check-circle"></i>') + '<span>' + escapeHtml(msg) + '</span>';
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2600);
}
function sha256Hex(str) {
    const input = String(str);
    if (!window.crypto || !window.crypto.subtle) {
        let hash = 0;
        for (let i = 0; i < input.length; i++) {
            hash = ((hash << 5) - hash) + input.charCodeAt(i);
            hash |= 0;
        }
        const h = '00000000' + (hash >>> 0).toString(16);
        return Promise.resolve(h.slice(-8));
    }
    const buf = new TextEncoder().encode(input);
    return crypto.subtle.digest('SHA-256', buf).then(digest =>
        Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
    );
}

// ============ Sessao e login do cliente ============
let _client = null;

function loadClientSession() {
    try { _client = JSON.parse(localStorage.getItem(CLIENT_SESSION_KEY) || 'null'); }
    catch (e) { _client = null; }
    return _client;
}
function saveClientSession(c) {
    if (c === null) { localStorage.removeItem(CLIENT_SESSION_KEY); _client = null; }
    else { _client = c; localStorage.setItem(CLIENT_SESSION_KEY, JSON.stringify(c)); }
    refreshClientAuthUI();
}
function isClientLoggedIn() { return !!(_client && _client.email); }
function getClientEmail() { return isClientLoggedIn() ? _client.email : ''; }

async function clientLogin(identifier, senha) {
    identifier = String(identifier || '').trim();
    if (!identifier || !senha) return { ok: false, error: 'Informe email e senha.' };
    try {
        const emailHash = await sha256Hex(senha);
        const cnpjOnly = senha.replace(/\D/g, '');
        const cnpjHash = cnpjOnly === senha ? emailHash : await sha256Hex(cnpjOnly);
        const { data, error } = await db.rpc('verificar_login', {
            _identificador: identifier,
            _senha_email: emailHash,
            _senha_cnpj: cnpjHash
        });
        if (error || !data || !data.length) return { ok: false, error: 'Erro ao autenticar. Tente novamente.' };
        const rec = data[0];
        if (rec.erro) {
            if (String(rec.erro).startsWith('LOCK:')) {
                const m = String(rec.erro).split(':')[1];
                return { ok: false, error: 'Muitas tentativas. Tente novamente em ' + m + ' minuto(s).' };
            }
            if (rec.erro === 'NAOCAD') return { ok: false, error: 'Cliente não cadastrado. Contate a loja.' };
            return { ok: false, error: 'Senha incorreta.' };
        }
        const mustChange = !rec.senha_trocada;
        saveClientSession({ id: rec.id, email: rec.email, razao: rec.razao_social, mustChange });
        return { ok: true, mustChange };
    } catch (err) {
        console.error(err);
        return { ok: false, error: 'Erro ao autenticar. Tente novamente.' };
    }
}

function clientLogout() {
    saveClientSession(null);
    localStorage.setItem(CART_KEY, '[]');
    updateCartBadge();
    renderCartSidebar();
    renderCatalog();
    showToast('Você saiu da conta.');
}

async function clientChangePassword(oldPass, newPass) {
    if (!isClientLoggedIn()) return { ok: false, error: 'Você precisa estar logado.' };
    if (!newPass || String(newPass).length < 4) return { ok: false, error: 'A nova senha deve ter pelo menos 4 caracteres.' };
    try {
        const antiga = await sha256Hex(String(oldPass));
        const nova = await sha256Hex(String(newPass));
        const { data: ok, error } = await db.rpc('alterar_senha', {
            _id: _client.id, _antiga_hash: antiga, _nova_hash: nova
        });
        if (error) {
            const msg = String((error && error.message) || '').toLowerCase();
            if (msg.includes('atual incorreta')) return { ok: false, error: 'Senha atual incorreta.' };
            return { ok: false, error: 'Erro ao trocar a senha.' };
        }
        _client.mustChange = false;
        saveClientSession(_client);
        return { ok: true };
    } catch (err) {
        console.error(err);
        return { ok: false, error: 'Erro ao trocar a senha.' };
    }
}

function priceLocked() {
    return '<i class="fas fa-lock"></i> Faça login para ver o preço';
}

function refreshClientAuthUI() {
    document.body.classList.toggle('isAuth', isClientLoggedIn());
    const loginBtn = document.getElementById('navLoginBtn');
    const chip = document.getElementById('navUserChip');
    const name = document.getElementById('navUserName');
    if (loginBtn) loginBtn.style.display = isClientLoggedIn() ? 'none' : '';
    if (chip) chip.style.display = isClientLoggedIn() ? '' : 'none';
    if (name) name.textContent = isClientLoggedIn() ? (_client.razao || 'Cliente') : 'Cliente';
}

// ============ Produtos ============
let _allProducts = [];
let _categories = [];
let _currentCategory = 'all';
let _searchTerm = '';

const PRODUCT_SELECT_FIELDS = 'id, codigo, nome, marca, categoria, subcategoria, preco, unidade, descricao, imagens, palavraschave, visivel, estoque, isdestaque, ispromocao, precopromocional, somente_orcamento, linha, embalagem';

function normalizeProduct(p) {
    return {
        ...p,
        palavrasChave: Array.isArray(p.palavraschave) ? p.palavraschave : [],
        isDestaque: !!p.isdestaque,
        isPromocao: !!p.ispromocao,
        precoPromocional: parseFloat(p.precopromocional) || 0,
        embalagem: parseInt(p.embalagem) || 1,
        _rnd: Math.random()
    };
}

async function loadProducts() {
    try {
        let all = [];
        let from = 0;
        const PAGE_SIZE = 500;
        while (true) {
            const { data, error } = await db.from(SUPABASE_PRODUCTS_TABLE)
                .select(PRODUCT_SELECT_FIELDS)
                .eq('visivel', true)
                .eq('linha', 'java')
                .or('somente_orcamento.eq.false,somente_orcamento.is.null')
                .order('id', { ascending: true })
                .range(from, from + PAGE_SIZE - 1);
            if (error) throw error;
            if (!data || data.length === 0) break;
            all = all.concat(data);
            if (data.length < PAGE_SIZE) break;
            from += PAGE_SIZE;
        }
        _allProducts = all.map(normalizeProduct);
    } catch (e) {
        console.error('Erro ao carregar produtos:', e);
        _allProducts = [];
    }
    window.products = _allProducts;
}

async function loadCategories() {
    try {
        let all = [];
        let from = 0;
        const PAGE_SIZE = 500;
        while (true) {
            const { data, error } = await db.from(SUPABASE_CATEGORIES_TABLE)
                .select('id, nome')
                .order('id', { ascending: true })
                .range(from, from + PAGE_SIZE - 1);
            if (error) throw error;
            if (!data || data.length === 0) break;
            all = all.concat(data);
            if (data.length < PAGE_SIZE) break;
            from += PAGE_SIZE;
        }
        _categories = all.sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
    } catch (e) {
        console.error('Erro ao carregar categorias:', e);
        _categories = [];
    }
}

function getFilteredProducts() {
    let list = _allProducts.slice();
    const categorySelected = _currentCategory && _currentCategory !== 'all';
    if (categorySelected) {
        list = list.filter(p => p.categoria === _currentCategory);
    }
    if (_searchTerm) {
        const t = _searchTerm.toLowerCase();
        list = list.filter(p => {
            const haystack = [
                (p.nome || ''), (p.marca || ''), (p.codigo || ''), (p.categoria || ''), (p.descricao || '')
            ].join(' ').toLowerCase();
            const kw = (p.palavraschave || []).join(' ').toLowerCase();
            return haystack.includes(t) || kw.includes(t);
        });
    }
    // Dentro de uma categoria: ordem alfabética.
    if (categorySelected) {
        return list.sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
    }
    // No "Todos": destaque e promoção no início; dentro de cada grupo ordem aleatória (estável por página).
    return list.sort((a, b) => {
        const wa = (a.isDestaque ? 2 : 0) + (a.isPromocao ? 1 : 0);
        const wb = (b.isDestaque ? 2 : 0) + (b.isPromocao ? 1 : 0);
        if (wb !== wa) return wb - wa;
        return (a._rnd == null ? 0 : a._rnd) - (b._rnd == null ? 0 : b._rnd);
    });
}

// ---------- Render ----------
function renderCatalog() {
    const grid = document.getElementById('gridAll');
    const empty = document.getElementById('catalogEmpty');
    const count = document.getElementById('catalogCount');
    if (!grid) return;

    const filtered = getFilteredProducts();
    if (count) count.textContent = filtered.length + ' produto' + (filtered.length !== 1 ? 's' : '') + ' disponíve' + (filtered.length !== 1 ? 'is' : 'l');

    if (filtered.length === 0) {
        grid.innerHTML = '';
        if (empty) empty.style.display = '';
        return;
    }
    if (empty) empty.style.display = 'none';

    grid.innerHTML = filtered.map(p => {
        const hasPromo = p.isPromocao && p.precoPromocional > 0;
        const price = hasPromo ? p.precoPromocional : p.preco;
        const emb = p.embalagem > 1 ? p.embalagem : 1;
        const img = (p.imagens && p.imagens.length > 0) ? p.imagens[0] : '';
        const thumb = img ? getThumbUrl(img) : '';

        const badges = [];
        if (p.isDestaque) badges.push('<span class="cat-badge destaque"><i class="fas fa-star"></i> Destaque</span>');
        if (p.isPromocao) badges.push('<span class="cat-badge promo"><i class="fas fa-fire"></i> Promoção</span>');

        const priceBlock = isClientLoggedIn()
            ? `<div class="cat-price">
                ${hasPromo ? `<span class="price-old">${formatPrice(p.preco)}</span>` : ''}
                <span class="price-now">${formatPrice(price)}</span>
                ${p.unidade ? `<span class="price-unit">/${escapeHtml(p.unidade)}</span>` : ''}
              </div>`
            : `<span class="price-lock">${priceLocked()}</span>`;

        return `
        <div class="catalog-card ${p.isDestaque ? 'isDestaque' : ''} ${p.isPromocao ? 'isPromo' : ''}" data-pid="${escapeHtml(p.id)}">
            <div class="cat-thumb">
                ${img
                    ? `<img src="${escapeHtml(thumb)}" alt="${escapeHtml(p.nome)}" loading="lazy" onerror="this.onerror=null;this.src='${escapeHtml(img)}'">`
                    : '<i class="fas fa-box-open" style="font-size:44px;color:#d8cfe8;"></i>'}
                ${badges.length ? `<div class="cat-badges">${badges.join('')}</div>` : ''}
            </div>
            <div class="cat-body">
                <span class="cat-code">${p.codigo ? 'CÓD ' + escapeHtml(p.codigo) : ''}</span>
                <h4 class="cat-name">${escapeHtml(p.nome)}</h4>
                <span class="cat-meta">${escapeHtml(p.marca || '')} ${p.categoria ? '• ' + escapeHtml(p.categoria) : ''}</span>
                ${emb > 1 ? `<span class="cat-meta cat-emb"><i class="fas fa-box" style="margin-right:4px"></i>Vendido em caixas de ${emb}</span>` : ''}
                ${priceBlock}
                <div class="cat-actions">
                    <div class="catalog-qty">
                        <button onclick="catalogQtyChange(this, -1)"><i class="fas fa-minus"></i></button>
                        <input type="number" value="${emb}" min="${emb}" step="${emb}" max="999" data-pid="${escapeHtml(p.id)}">
                        <button onclick="catalogQtyChange(this, 1)"><i class="fas fa-plus"></i></button>
                    </div>
                    <button class="btn-add-cart" onclick="addToCart(event, '${escapeHtml(p.id)}')">
                        <i class="fas fa-cart-plus"></i> Adicionar
                    </button>
                </div>
            </div>
        </div>`;
    }).join('');
}

function renderCategoryPills() {
    const el = document.getElementById('catalogCats');
    if (!el) return;
    const items = [
        { name: 'all', label: 'Todos' },
        ..._categories.map(c => ({ name: c.nome, label: c.nome }))
    ];
    el.innerHTML = items.map(c => `
        <button class="cat-pill ${c.name === _currentCategory ? 'active' : ''}" data-cat="${escapeHtml(c.name)}">
            ${escapeHtml(c.label)}
        </button>
    `).join('');
}

function selectCategory(cat) {
    _currentCategory = cat;
    renderCategoryPills();
    renderCatalog();
}

// ---------- Carrinho ----------
function getCart() {
    try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]'); }
    catch (e) { return []; }
}
function saveCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    updateCartBadge();
    renderCartSidebar();
    // Trigger pulse animation on badge
    const badge = document.getElementById('cartBadge');
    if (badge && badge.style.display !== 'none') {
        badge.style.animation = 'none';
        badge.offsetHeight; // force reflow
        badge.style.animation = 'badgePulse 0.4s ease-out';
    }
}
function updateCartBadge() {
    const badge = document.getElementById('cartBadge');
    if (!badge) return;
    const total = getCart().reduce((s, i) => s + i.qty, 0);
    badge.textContent = total;
    badge.style.display = total > 0 ? 'flex' : 'none';
}

function catalogQtyChange(btn, delta) {
    const input = btn.closest('.catalog-qty').querySelector('input');
    const pid = input.getAttribute('data-pid');
    const p = pid ? _allProducts.find(x => String(x.id) === String(pid)) : null;
    const emb = (p && p.embalagem > 1) ? p.embalagem : 1;
    let v = parseInt(input.value) || emb;
    if (v < emb || v % emb) v = emb;
    const v2 = v + delta * emb;
    if (v2 < emb) v = emb; else v = Math.min(v2, 999);
    input.value = v;
}

function getQtyForEl(btn) {
    const card = btn.closest('.catalog-card, .pm-actions');
    const input = card ? card.querySelector('.catalog-qty input, .pm-qty input') : null;
    return input ? (parseInt(input.value) || 1) : 1;
}

function addToCart(event, productId) {
    console.log('[addToCart] called', { event: !!event, productId, target: event?.target });
    if (!isClientLoggedIn()) { 
        console.log('[addToCart] NOT logged in');
        openClientLoginModal(); 
        showToast('Faça login para ver preços e montar o orçamento.', true); 
        return; 
    }
    console.log('[addToCart] logged in ok');
    console.log('[addToCart] _allProducts IDs:', _allProducts.map(p => p.id).slice(0, 20));
    const product = _allProducts.find(p => String(p.id) === String(productId));
    console.log('[addToCart] product found', { product: !!product, productId, totalProducts: _allProducts.length });
    if (!product) return;

    let qty = getQtyForEl(event && event.target);
    const emb = product.embalagem > 1 ? product.embalagem : 1;
    if (qty % emb) { qty = Math.ceil(qty / emb) * emb; }
    const hasPromo = product.isPromocao && product.precoPromocional > 0;
    const img = (product.imagens && product.imagens.length > 0) ? product.imagens[0] : '';
    const thumb = img ? getThumbUrl(img) : '';

    const cart = getCart();
    const existing = cart.find(i => i.id === product.id);
    if (existing) {
        existing.qty += qty;
    } else {
        cart.push({
            id: product.id,
            codigo: product.codigo || '',
            nome: product.nome,
            categoria: product.categoria || '',
            preco: hasPromo ? product.precoPromocional : product.preco,
            imagem: thumb,
            embalagem: product.embalagem || 1,
            qty: qty
        });
    }
    saveCart(cart);
    showToast('Adicionado ao carrinho: ' + product.nome);

    const btn = event && event.target;
    const card = btn ? btn.closest('.catalog-card, .pm-body') : null;
    const qtyInput = card ? card.querySelector('.catalog-qty input, .pm-qty input') : null;
    if (qtyInput) qtyInput.value = 1;
}

function cartQtyChange(id, delta) {
    const cart = getCart();
    const item = cart.find(i => String(i.id) === String(id));
    if (!item) return;
    const emb = Number(item.embalagem) > 1 ? Number(item.embalagem) : 1;
    item.qty += delta * emb;
    if (item.qty <= 0) removeFromCart(id);
    else saveCart(cart);
}

function removeFromCart(id) {
    saveCart(getCart().filter(i => String(i.id) !== String(id)));
}

function renderCartSidebar() {
    const container = document.getElementById('cartItems');
    const footer = document.getElementById('cartFooter');
    const empty = document.getElementById('cartEmpty');
    if (!container) return;

    const cart = getCart();
    if (cart.length === 0) {
        container.innerHTML = '';
        if (empty) empty.style.display = '';
        if (footer) footer.style.display = 'none';
        return;
    }
    if (empty) empty.style.display = 'none';

    container.innerHTML = cart.map(item => `
        <div class="cart-item">
            ${item.imagem ? `<img src="${escapeHtml(item.imagem)}" alt="${escapeHtml(item.nome)}" onerror="this.onerror=null;this.src=this.src.replace('_thumb.webp','.webp');this.style.display='none'">` : ''}
            <div class="cart-item-info">
                <span class="cart-item-code">${item.codigo ? 'CÓD ' + escapeHtml(item.codigo) : ''}</span>
                <h4>${escapeHtml(item.nome)}</h4>
                <div class="cart-item-price">${formatPrice(item.preco)}</div>
            </div>
            <div class="cart-item-qty">
                <button onclick="cartQtyChange('${item.id}', -1)"><i class="fas fa-minus"></i></button>
                <span>${item.qty}</span>
                <button onclick="cartQtyChange('${item.id}', 1)"><i class="fas fa-plus"></i></button>
            </div>
            <button class="cart-item-remove" onclick="removeFromCart('${item.id}')"><i class="fas fa-trash"></i></button>
        </div>
    `).join('');

    const total = cart.reduce((s, i) => s + i.qty * i.preco, 0);
    document.getElementById('cartTotal').textContent = formatPrice(total);
    if (footer) footer.style.display = '';
}

// ---------- Cart UI ----------
function openCart() {
    document.getElementById('cartSidebar').classList.add('open');
    document.getElementById('cartOverlay').classList.add('active');
    document.body.style.overflow = 'hidden';
}
function closeCart() {
    document.getElementById('cartSidebar').classList.remove('open');
    document.getElementById('cartOverlay').classList.remove('active');
    document.body.style.overflow = '';
}

// ---------- Product modal ----------
function openProductModal(productId) {
    const product = _allProducts.find(p => p.id === productId);
    if (!product) return;

    const hasPromo = product.isPromocao && product.precoPromocional > 0;
    const price = hasPromo ? product.precoPromocional : product.preco;
    const emb = product.embalagem > 1 ? product.embalagem : 1;
    const img = (product.imagens && product.imagens.length > 0) ? product.imagens[0] : '';
    const thumb = img ? getThumbUrl(img) : '';

    const badges = [];
    if (product.isDestaque) badges.push('<span class="cat-badge destaque"><i class="fas fa-star"></i> Destaque</span>');
    if (product.isPromocao) badges.push('<span class="cat-badge promo"><i class="fas fa-fire"></i> Promoção</span>');

    const body = document.getElementById('productModalBody');
    body.innerHTML = `
        <button class="pm-close-btn" onclick="closeProductModal()"><i class="fas fa-xmark"></i></button>
        <div class="pm-body">
            <div class="pm-img">
                ${img
                    ? `<img src="${escapeHtml(thumb)}" alt="${escapeHtml(product.nome)}" onerror="this.onerror=null;this.src='${escapeHtml(img)}'">`
                    : '<i class="fas fa-box-open" style="font-size:64px;color:#d8cfe8;"></i>'}
            </div>
            <div class="pm-info">
                ${badges.length ? `<div class="cat-badges" style="position:static;margin-bottom:8px;">${badges.join('')}</div>` : ''}
                <span class="pm-code">${product.codigo ? 'CÓD ' + escapeHtml(product.codigo) : ''} ${product.marca ? '• ' + escapeHtml(product.marca) : ''}</span>
                <h2>${escapeHtml(product.nome)}</h2>
                <p class="pm-desc">${escapeHtml(product.descricao || 'Sem descrição disponível.')}</p>
                <span class="cat-meta">${escapeHtml(product.categoria || '')} ${product.subcategoria ? '• ' + escapeHtml(product.subcategoria) : ''}</span>
                <div class="pm-price">
                    ${isClientLoggedIn()
                        ? `${hasPromo ? `<span class="price-old">${formatPrice(product.preco)}</span> ` : ''}<span class="price-now">${formatPrice(price)}</span> ${product.unidade ? '<small class="price-unit">/' + escapeHtml(product.unidade) + '</small>' : ''}`
                        : `<span class="pm-price-msg">${priceLocked()}</span>`}
                </div>
                ${emb > 1 ? `<span class="cat-meta cat-emb" style="margin-top:6px"><i class="fas fa-box" style="margin-right:4px"></i>Vendido em caixas de ${emb}</span>` : ''}
                <div class="pm-actions">
                    <div class="catalog-qty pm-qty">
                        <button onclick="catalogQtyChange(this, -1)"><i class="fas fa-minus"></i></button>
                        <input type="number" value="${emb}" min="${emb}" step="${emb}" max="999" data-pid="${product.id}">
                        <button onclick="catalogQtyChange(this, 1)"><i class="fas fa-plus"></i></button>
                    </div>
                    <button class="btn-add-cart" style="flex:1;" onclick="addToCart(event, '${product.id}')">
                        <i class="fas fa-cart-plus"></i> Adicionar ao carrinho
                    </button>
                </div>
            </div>
        </div>`;
    document.getElementById('productOverlay').classList.add('active');
    document.body.style.overflow = 'hidden';
}
function closeProductModal() {
    document.getElementById('productOverlay').classList.remove('active');
    document.body.style.overflow = '';
}

// ---------- Checkout ----------
function generateClientCode(email) {
    const e = String(email || '').trim().toLowerCase();
    const ints = e.split('').map(c => c.charCodeAt(0)).filter(n => n % 2 === 0);
    const sum = ints.reduce((s, n) => s + n % 10, 0);
    const code = (sum * 7 + e.length * 3) % 9999;
    return 'C-' + String(code).padStart(4, '0');
}
function generatePickupCode() {
    return String(Math.floor(1000 + Math.random() * 9000));
}

function openCheckout() {
    const cart = getCart();
    if (cart.length === 0) { showToast('Seu carrinho está vazio.', true); return; }
    if (!isClientLoggedIn()) { openClientLoginModal(); return; }

    const itemEl = document.getElementById('checkoutItems');
    const formEl = document.getElementById('checkoutForm');
    const totalEl = document.querySelector('.checkout-total');
    const successEl = document.getElementById('checkoutSuccess');
    const sendBtn = document.getElementById('checkoutSendBtn');
    const errBox = document.getElementById('checkoutError');
    if (itemEl) itemEl.style.display = '';
    if (formEl) formEl.style.display = '';
    if (totalEl) totalEl.style.display = '';
    if (successEl) successEl.style.display = 'none';
    if (sendBtn) { sendBtn.disabled = false; sendBtn.innerHTML = '<i class="fas fa-check"></i> Concluir Orçamento'; }
    if (errBox) errBox.style.display = 'none';

    document.getElementById('checkoutItems').innerHTML = cart.map(item => `
        <div class="checkout-item-summary">
            <span class="ci-name">${escapeHtml(item.nome)} ${item.codigo ? `<small>(${escapeHtml(item.codigo)})</small>` : ''}</span>
            <span class="ci-val">${item.qty}x ${formatPrice(item.preco)}</span>
        </div>
    `).join('');

    const total = cart.reduce((s, i) => s + i.qty * i.preco, 0);
    document.getElementById('checkoutSubtotal').textContent = formatPrice(total);
    document.getElementById('checkoutOverlay').classList.add('active');
    document.body.style.overflow = 'hidden';
}
function closeCheckout() {
    document.getElementById('checkoutOverlay').classList.remove('active');
    document.body.style.overflow = '';
}

async function submitQuote(e) {
    e.preventDefault();
    const email = getClientEmail();
    const errBox = document.getElementById('checkoutError');
    const errText = document.getElementById('checkoutErrorText');

    if (errBox) errBox.style.display = 'none';

    if (!email) {
        if (errBox) { errText.textContent = 'Faça login com seu usuário para finalizar o orçamento.'; errBox.style.display = ''; }
        openClientLoginModal();
        return;
    }

    const cart = getCart();
    if (cart.length === 0) return;

    const badEmb = cart.filter(it => Number(it.embalagem || 1) > 1 && (it.qty % Number(it.embalagem)) !== 0);
    if (badEmb.length) {
        if (errBox) { errText.textContent = badEmb[0].nome + ' é vendido em caixas de ' + badEmb[0].embalagem + ' — ajuste a quantidade.'; errBox.style.display = ''; }
        return;
    }

    const pagamento = document.getElementById('checkoutPayment')?.value || '';
    if (!pagamento) {
        if (errBox) { errText.textContent = 'Selecione o prazo de pagamento.'; errBox.style.display = ''; }
        return;
    }

    const btn = document.getElementById('checkoutSendBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Registrando...'; }

    let total = 0;
    const itens = cart.map(item => {
        const subtotal = item.preco * item.qty;
        total += subtotal;
        return {
            codigo: item.codigo || '',
            nome: item.nome,
            categoria: item.categoria || '',
            quantidade: item.qty,
            preco: item.preco,
            subtotal: subtotal
        };
    });

    const code = generateClientCode(email);
    const pickupCode = generatePickupCode();

    try {
        await db.rpc('criar_orcamento', { _payload: {
            nome_cliente: email,
            email: email,
            telefone: '',
            codigo_cliente: code,
            codigo_retirada: pickupCode,
            itens: itens,
            total: total,
            pagamento: pagamento,
            status: 'recebido',
            status_entrega: 'pendente',
            linha: 'java'
        } });
    } catch (err) {
        console.error('Erro ao salvar orçamento:', err);
        if (errBox) { errText.textContent = 'Não foi possível registrar o orçamento. Tente novamente em instantes.'; errBox.style.display = ''; }
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Concluir Orçamento'; }
        return;
    }

    const form = document.getElementById('checkoutForm');
    if (form) form.reset();
    localStorage.setItem(CART_KEY, '[]');
    updateCartBadge();
    renderCartSidebar();
    showCheckoutSuccess(code);
}

function showCheckoutSuccess(code) {
    const itemsEl = document.getElementById('checkoutItems');
    const totalEl = document.querySelector('.checkout-total');
    const formEl = document.getElementById('checkoutForm');
    const successEl = document.getElementById('checkoutSuccess');
    const codeEl = document.getElementById('checkoutSuccessCode');
    if (itemsEl) itemsEl.style.display = 'none';
    if (totalEl) totalEl.style.display = 'none';
    if (formEl) formEl.style.display = 'none';
    if (codeEl) codeEl.textContent = '#' + code;
    if (successEl) successEl.style.display = '';
    showToast('Orçamento #' + code + ' registrado com sucesso!');
}

// ---------- Auth modals ----------
function showClientAuthView(which) {
    const lv = document.getElementById('clientLoginView');
    const pv = document.getElementById('clientPwdView');
    if (lv) lv.style.display = (which === 'login') ? '' : 'none';
    if (pv) pv.style.display = (which === 'pwd') ? '' : 'none';
}

function openClientLoginModal() {
    const ov = document.getElementById('clientLoginOverlay');
    if (!ov) return;
    const le = document.getElementById('clientLoginError');
    if (le) le.style.display = 'none';
    const pe = document.getElementById('clientPwdError');
    if (pe) pe.style.display = 'none';
    showClientAuthView('login');
    ov.classList.add('active');
    document.body.style.overflow = 'hidden';
    const emailEl = document.getElementById('clLoginEmail');
    if (emailEl) setTimeout(() => emailEl.focus(), 60);
}
function closeClientLoginModal() {
    const ov = document.getElementById('clientLoginOverlay');
    if (ov) ov.classList.remove('active');
    document.body.style.overflow = '';
}

async function submitClientLogin(e) {
    e.preventDefault();
    const email = document.getElementById('clLoginEmail').value.trim();
    const senha = document.getElementById('clLoginSenha').value;
    const err = document.getElementById('clientLoginError');
    const btn = document.getElementById('clientLoginSubmit');
    if (err) err.style.display = 'none';
    if (!email || !senha) { if (err) { err.textContent = 'Informe seu email e senha.'; err.style.display = ''; } return; }
    if (btn) btn.disabled = true;
    const r = await clientLogin(email, senha);
    if (btn) btn.disabled = false;
    if (!r.ok) { if (err) { err.textContent = r.error; err.style.display = ''; } return; }
    document.getElementById('clLoginEmail').value = '';
    document.getElementById('clLoginSenha').value = '';
    if (r.mustChange) {
        const pe = document.getElementById('clientPwdError');
        if (pe) pe.style.display = 'none';
        document.getElementById('clPwdOld').value = '';
        document.getElementById('clPwdNew').value = '';
        document.getElementById('clPwdConfirm').value = '';
        showClientAuthView('pwd');
    } else {
        closeClientLoginModal();
        renderCatalog();
        renderCartSidebar();
        showToast('Login realizado. Bem-vindo, ' + (_client.razao || '') + '!');
    }
}

function openClientPwdModal() {
    const ov = document.getElementById('clientLoginOverlay');
    if (!ov) return;
    const pe = document.getElementById('clientPwdError');
    if (pe) pe.style.display = 'none';
    document.getElementById('clPwdOld').value = '';
    document.getElementById('clPwdNew').value = '';
    document.getElementById('clPwdConfirm').value = '';
    showClientAuthView('pwd');
    ov.classList.add('active');
    document.body.style.overflow = 'hidden';
    const oldEl = document.getElementById('clPwdOld');
    if (oldEl) setTimeout(() => oldEl.focus(), 60);
}
function closeClientPwdModal() {
    closeClientLoginModal();
}

async function submitClientPwdChange(e) {
    e.preventDefault();
    const oldP = document.getElementById('clPwdOld').value;
    const newP = document.getElementById('clPwdNew').value;
    const conf = document.getElementById('clPwdConfirm').value;
    const err = document.getElementById('clientPwdError');
    if (err) err.style.display = 'none';
    if (newP !== conf) { if (err) { err.textContent = 'As senhas não conferem.'; err.style.display = ''; } return; }
    const r = await clientChangePassword(oldP, newP);
    if (!r.ok) { if (err) { err.textContent = r.error || 'Erro ao trocar a senha.'; err.style.display = ''; } return; }
    closeClientPwdModal();
    renderCatalog();
    renderCartSidebar();
    showToast('Senha alterada com sucesso.');
}

// ---------- Init & UI ----------
document.addEventListener('DOMContentLoaded', function () {
    loadClientSession();
    refreshClientAuthUI();
    renderCategoryPills();
    renderCatalog();
    updateCartBadge();
    renderCartSidebar();
    setupUI();
    Promise.all([loadProducts(), loadCategories()]).then(() => {
        renderCategoryPills();
        renderCatalog();
    });
});

function setupUI() {
    const toggle = document.getElementById('navToggle');
    const nav = document.getElementById('mainNav');
    if (toggle) toggle.addEventListener('click', () => nav && nav.classList.toggle('open'));

    const loginBtn = document.getElementById('navLoginBtn');
    if (loginBtn) loginBtn.addEventListener('click', openClientLoginModal);

    const chip = document.getElementById('navUserChip');
    if (chip) chip.addEventListener('click', () => {
        if (isClientLoggedIn()) openClientPwdModal();
        else openClientLoginModal();
        if (event.currentTarget.querySelector('i') && ((event.currentTarget.textContent || '').trim() || '').toLowerCase().includes('sair')) clientLogout();
    });

    const clientLoginClose = document.getElementById('clientLoginClose');
    const clientLoginOverlay = document.getElementById('clientLoginOverlay');
    if (clientLoginClose) clientLoginClose.addEventListener('click', closeClientLoginModal);
    if (clientLoginOverlay) clientLoginOverlay.addEventListener('click', (e) => {
        if (e.target === clientLoginOverlay) closeClientLoginModal();
    });
    const clientLoginForm = document.getElementById('clientLoginForm');
    if (clientLoginForm) clientLoginForm.addEventListener('submit', submitClientLogin);

    const clientPwdForm = document.getElementById('clientPwdForm');
    if (clientPwdForm) clientPwdForm.addEventListener('submit', submitClientPwdChange);

    const clientLogoutBtn = document.getElementById('clientLogoutBtn');
    if (clientLogoutBtn) clientLogoutBtn.addEventListener('click', clientLogout);

    const catsEl = document.getElementById('catalogCats');
    if (catsEl) catsEl.addEventListener('click', (e) => {
        const pill = e.target.closest('.cat-pill');
        if (pill) selectCategory(pill.dataset.cat);
    });

    const gridAll = document.getElementById('gridAll');
    if (gridAll) gridAll.addEventListener('click', (e) => {
        const card = e.target.closest('.catalog-card');
        if (!card) return;
        if (e.target.closest('.cat-actions')) return;
        const pid = card.getAttribute('data-pid');
        if (pid) openProductModal(pid);
    });

    const search = document.getElementById('searchInput');
    let debounce;
    if (search) search.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => { _searchTerm = search.value.trim(); renderCatalog(); }, 250);
    });

    const navCart = document.getElementById('navCartBtn');
    const cartOverlay = document.getElementById('cartOverlay');
    const cartClose = document.getElementById('cartClose');
    if (navCart) navCart.addEventListener('click', openCart);
    if (cartClose) cartClose.addEventListener('click', closeCart);
    if (cartOverlay) cartOverlay.addEventListener('click', closeCart);

    const cartCheckout = document.getElementById('cartCheckout');
    const checkoutClose = document.getElementById('checkoutClose');
    const checkoutOverlay = document.getElementById('checkoutOverlay');
    if (cartCheckout) cartCheckout.addEventListener('click', openCheckout);
    if (checkoutClose) checkoutClose.addEventListener('click', closeCheckout);
    if (checkoutOverlay) checkoutOverlay.addEventListener('click', (e) => {
        if (e.target === checkoutOverlay) closeCheckout();
    });

    const checkoutForm = document.getElementById('checkoutForm');
    if (checkoutForm) checkoutForm.addEventListener('submit', submitQuote);

    const checkoutSuccessClose = document.getElementById('checkoutSuccessClose');
    if (checkoutSuccessClose) checkoutSuccessClose.addEventListener('click', closeCheckout);

    const productOverlay = document.getElementById('productOverlay');
    if (productOverlay) productOverlay.addEventListener('click', (e) => {
        if (e.target === productOverlay) closeProductModal();
    });

    const header = document.getElementById('siteHeader');
    window.addEventListener('scroll', () => {
        if (header) header.classList.toggle('scrolled', window.scrollY > 40);
    });

    // ===== Cookie Consent =====
    const cookieConsent = document.getElementById('cookieConsent');
    if (cookieConsent && !localStorage.getItem('cookie_consent')) {
        setTimeout(() => cookieConsent.classList.add('show'), 500);
    }
    const cookieAccept = document.getElementById('cookieAccept');
    const cookieReject = document.getElementById('cookieReject');
    if (cookieAccept) {
        cookieAccept.addEventListener('click', () => {
            localStorage.setItem('cookie_consent', 'accepted');
            cookieConsent.classList.remove('show');
        });
    }
    if (cookieReject) {
        cookieReject.addEventListener('click', () => {
            localStorage.setItem('cookie_consent', 'rejected');
            cookieConsent.classList.remove('show');
        });
    }
}