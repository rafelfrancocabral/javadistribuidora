// ============================================================
// Cloudflare Worker - Uploader de imagens para R2 (Java Distribuidora)
// ============================================================
// Como instalar no painel da Cloudflare:
//  1. Dashboard Cloudflare -> Workers & Pages -> Create Worker.
//  2. Substitua o codigo pelo conteudo deste arquivo e clique em Deploy.
//  3. Em Settings > Variables and Secrets, crie um Binding R2:
//       - Variable name: IMAGES
//       - R2 Bucket:      produtos   (crie o bucket R2 "produtos" antes)
//  4. (Opcional, recomendado) Em Variables, crie UPLOAD_SECRET com uma
//     senha qualquer. Se criar, cole a mesma senha em js/r2-config.js.
//  5. No bucket R2 "produtos": Settings > Public Access > enable
//     "r2.dev subdomain" (copia o endereco pub-xxxx.r2.dev) OU aponte um
//     dominio proprio.
//  6. Cole a URL do Worker e a URL publica em js/r2-config.js.
// ============================================================

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });
}

export default {
    async fetch(request, env) {
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: CORS_HEADERS });
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
