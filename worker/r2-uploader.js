// ============================================================
// Cloudflare Worker - Uploader de imagens para R2 (Java Distribuidora)
// ============================================================
// INSTALACAO (via wrangler):
//  1. cd worker && wrangler deploy  (configuracao em wrangler.toml)
//  2. Binding R2 "IMAGES" -> bucket "produtosjava"
//  3. Variaveis SUPABASE_URL e SUPABASE_ANON_KEY em [vars] no wrangler.toml
//  4. Nenhum segredo de upload no cliente: o Worker valida o token de sessao
//     do painel (48 hex) pela RPC public.admin_verificar do Supabase.
//  5. IMPORTANTE: edite ALLOWED_ORIGINS abaixo com o dominio real do site
//     (ex.: https://javadistribuidora.vercel.app e seu dominio proprio, se houver).
//     Sem isso, o worker rejeita os uploads de origens desconhecidas.
// ============================================================

// Dominios que podem fazer upload. Adicione aqui TODOS os dominios do site
// (com https://, sem barra final). Se a lista estiver vazia, uploads de
// qualquer origem sao aceitos (apenas como fallback de configuracao).
const ALLOWED_ORIGINS = [
    'https://javadistribuidora.vercel.app',
    'https://www.javadistribuidora.com.br',
    'https://javadistribuidora.com.br',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:8080',
    'http://127.0.0.1:8080',
    'http://localhost:8000',
    'http://127.0.0.1:8000',
    'http://localhost:8100',
    'http://127.0.0.1:8100'
];

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

// Rejeita chamadas vindas de sites estranhos (nao confiavel sozinho,
// mas bloqueia abuso via scripts de terceiros).
function originAllowed(request) {
    if (!ALLOWED_ORIGINS.length) return true;
    const origin = request.headers.get('Origin') || '';
    if (!origin) return true; // requisicoes sem Origin (ex.: curl) passam pelo Bearer
    return ALLOWED_ORIGINS.includes(origin);
}

function json(data, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...extraHeaders }
    });
}

// Valida o token de sessao do painel (48 hex) pela RPC admin_verificar do Supabase.
// Nenhum segredo compartilhado fica no front-end: so vale um token de admin ativo.
async function adminAutorizado(request, env) {
    const auth = request.headers.get('Authorization') || '';
    const match = auth.match(/^Bearer\s+([0-9a-f]{48})$/i);
    if (!match) return false;

    const base = (env.SUPABASE_URL || '').replace(/\/+$/, '');
    if (!base || !env.SUPABASE_ANON_KEY) {
        console.error('Configuracao ausente: SUPABASE_URL / SUPABASE_ANON_KEY');
        return false;
    }

    try {
        const res = await fetch(base + '/rest/v1/rpc/admin_verificar', {
            method: 'POST',
            headers: {
                'apikey': env.SUPABASE_ANON_KEY,
                'Authorization': 'Bearer ' + env.SUPABASE_ANON_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ _token: match[1] })
        });
        if (!res.ok) return false;
        return (await res.json()) === true;
    } catch (e) {
        console.error('Falha ao validar sessao admin:', e && e.message ? e.message : e);
        return false;
    }
}

export default {
    async fetch(request, env) {
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: CORS_HEADERS });
        }

        const url = new URL(request.url);

        // Servir imagens do R2 com CORS (usado pelo catalogo PDF para embutir fotos)
        if (url.pathname === '/image' && request.method === 'GET') {
            const key = url.searchParams.get('key');
            const remoteUrl = url.searchParams.get('url');
            // Modo 1: ler do bucket R2
            if (key) {
                if (!/^produtos\/[A-Za-z0-9._-]+\.(webp|jpg|jpeg|png|gif)$/i.test(key)) {
                    return json({ error: 'chave invalida' }, 400);
                }
                const obj = await env.IMAGES.get(key);
                if (!obj) return json({ error: 'nao encontrado' }, 404);
                const headers = new Headers(CORS_HEADERS);
                headers.set('Content-Type', obj.httpMetadata?.contentType || 'image/webp');
                headers.set('Cache-Control', 'public, max-age=31536000, immutable');
                return new Response(obj.body, { status: 200, headers });
            }
            // Modo 2: proxy de imagem externa (qualquer host, mas apenas imagens)
            if (remoteUrl) {
                let parsed;
                try { parsed = new URL(remoteUrl); } catch (e) { return json({ error: 'url invalida' }, 400); }
                if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
                    return json({ error: 'protocolo invalido' }, 400);
                }
                let r;
                try {
                    r = await fetch(remoteUrl);
                } catch (e) {
                    return json({ error: 'falha de rede: ' + (e && e.message ? e.message : e) }, 502);
                }
                if (!r.ok) return json({ error: 'origem retornou ' + r.status }, 502);
                const ct = r.headers.get('Content-Type') || '';
                if (!ct.toLowerCase().startsWith('image/')) {
                    return json({ error: 'conteudo nao e imagem (' + ct + ')' }, 415);
                }
                const headers = new Headers(CORS_HEADERS);
                headers.set('Content-Type', ct);
                headers.set('Cache-Control', 'public, max-age=86400');
                return new Response(r.body, { status: 200, headers });
            }
            return json({ error: 'parametros ausentes (key ou url)' }, 400);
        }

        if (!originAllowed(request)) {
            return json({ error: 'origem nao permitida' }, 403);
        }

        if (url.pathname === '/health') {
            return json({ ok: true, hasBucket: !!env.IMAGES });
        }

        if (url.pathname === '/upload' && request.method === 'POST') {
            if (!(await adminAutorizado(request, env))) {
                return json({ error: 'unauthorized' }, 401);
            }
            try {
                return await handleUpload(request, env);
            } catch (e) {
                return json({ error: e.message || 'internal error' }, 500);
            }
        }

        return json({ error: 'not found' }, 404);
    }
};

const ALLOWED_IMAGE_HOSTS = [
    'spiritcdn.spiritshop.com.br',
    'pub-3898e6d68e494c019d1a509264328a33.r2.dev'
];

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB

async function handleUpload(request, env) {
    const form = await request.formData();
    const main = form.get('main');
    const thumb = form.get('thumb');
    const hash = (form.get('hash') || '').trim();

    if (!main || !thumb) return json({ error: 'main e thumb sao obrigatorios' }, 400);
    // hash forte (SHA-256) evita escrever em caminhos arbitrarios do bucket
    if (!/^[a-f0-9]{64}$/.test(hash)) return json({ error: 'hash invalido' }, 400);
    if (main.type !== 'image/webp' || thumb.type !== 'image/webp') {
        return json({ error: 'apenas imagens webp sao aceitas' }, 415);
    }
    if (main.size > MAX_FILE_BYTES || thumb.size > MAX_FILE_BYTES) {
        return json({ error: 'imagem muito grande (max 5MB)' }, 413);
    }

    const mainKey = `produtos/${hash}.webp`;
    const thumbKey = `produtos/${hash}_thumb.webp`;
    const meta = {
        httpMetadata: {
            contentType: 'image/webp',
            cacheControl: 'public, max-age=31536000, immutable'
        }
    };

    const existingMain = await env.IMAGES.head(mainKey);
    const existingThumb = await env.IMAGES.head(thumbKey);
    if (!existingMain) {
        await env.IMAGES.put(mainKey, main.stream(), meta);
    }
    if (!existingThumb) {
        await env.IMAGES.put(thumbKey, thumb.stream(), meta);
    }

    return json({ ok: true, keys: [mainKey, thumbKey] });
}
