// ============================================================
// Cloudflare Worker - Uploader de imagens para R2 (Java Distribuidora)
// ============================================================
// INSTALACAO:
//  1. Dashboard Cloudflare -> Workers & Pages -> worker "javadistribuidora-uploader"
//  2. Substitua o codigo por este arquivo e clique em Deploy.
//  3. Settings > Variables and Secrets:
//       - R2 binding "IMAGES" apontando para o bucket "produtos"
//       - Variavel secreta UPLOAD_SECRET = valor atual de js/r2-config.js (R2_WORKER_SECRET)
//  4. IMPORTANTE: edite ALLOWED_ORIGINS abaixo com o dominio real do site
//     (ex.: https://javadistribuidora.vercel.app e seu dominio proprio, se houver).
//     Sem isso, o worker rejeita os uploads (ou aceita de qualquer origem se a lista
//     estiver vazia - nao recomendado).
// ============================================================

// Dominios que podem fazer upload. Adicione aqui TODOS os dominios do site
// (com https://, sem barra final). Se a lista estiver vazia, uploads de
// qualquer origem sao aceitos (apenas como fallback de configuracao).
const ALLOWED_ORIGINS = [
    'https://javadistribuidora.vercel.app',
    'http://localhost:3000',
    'http://localhost:5173'
];

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

export default {
    async fetch(request, env) {
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: CORS_HEADERS });
        }

        if (!originAllowed(request)) {
            return json({ error: 'origem nao permitida' }, 403);
        }

        if (env.UPLOAD_SECRET) {
            const auth = request.headers.get('Authorization') || '';
            if (auth !== `Bearer ${env.UPLOAD_SECRET}`) {
                return json({ error: 'unauthorized' }, 401);
            }
        }

        const url = new URL(request.url);

        try {
            if (url.pathname === '/health') {
                return json({ ok: true, hasBucket: !!env.IMAGES });
            }
            if (url.pathname === '/upload' && request.method === 'POST') {
                return await handleUpload(request, env);
            }
        } catch (e) {
            return json({ error: e.message || 'internal error' }, 500);
        }

        return json({ error: 'not found' }, 404);
    }
};

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