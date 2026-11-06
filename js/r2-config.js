// ============================================================
// Cloudflare R2 - Configuracao do cliente (Java Distribuidora)
// ============================================================
// 1. R2_WORKER_URL      -> URL do Worker criado no painel da Cloudflare
// 2. R2_PUBLIC_BASE_URL -> URL publica do bucket R2
//
// O upload e autenticado com o token de sessao do administrador
// (localStorage: jv2_admin_auth) e validado pelo Worker via Supabase.
// Nenhum segredo de upload fica neste arquivo.
// ============================================================

const R2_WORKER_URL        = 'https://javadistribuidora-uploader.rafaelfrancocabral.workers.dev';
const R2_PUBLIC_BASE_URL   = 'https://pub-3898e6d68e494c019d1a509264328a33.r2.dev';
