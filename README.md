# Java Distribuidora

Loja de ferramentas para distribuidora — catálogo com orçamento via WhatsApp e painel administrativo.

## Estrutura

```
javadistribuidora/
├── index.html            # Site público (hero, produtos, contato)
├── login.html            # Login do administrador
├── dashboard.html        # Painel administrativo
├── css/
│   ├── style.css         # Estilo tech/neon do site
│   └── dashboard.css     # Estilo do painel
├── js/
│   ├── script.js         # Lógica do site público
│   ├── dashboard.js      # Lógica do painel
│   ├── supabase-config.js# Credenciais Supabase
│   ├── r2-config.js      # Configuração Cloudflare R2
│   └── logo-data.js      # Logo base64 para o PDF
├── sql/
│   └── supabase-schema.sql  # Schema do banco
├── worker/
│   └── r2-uploader.js    # Cloudflare Worker (upload de imagens)
├── img/
└── vercel.json
```

## Configuração

### 1. Supabase
Execute o arquivo `sql/supabase-schema.sql` no SQL Editor do Supabase. As credenciais já estão em `js/supabase-config.js`.

Tabelas: `produtos`, `categorias`, `subcategorias`, `orcamentos`, `clientes`. Storage bucket: `produtos`.

### 2. Cloudflare R2 (upload de imagens)
1. Crie um bucket R2 chamado `produtosjava` e habilite o "r2.dev subdomain" (ou domínio próprio).
2. Deploy do Worker via Wrangler (configuração em `worker/wrangler.toml`):
   ```bash
   cd worker
   wrangler deploy
   ```
   O binding `IMAGES` aponta para `produtosjava` e as variáveis `SUPABASE_URL` / `SUPABASE_ANON_KEY` ficam em `[vars]`.
3. Autenticação do upload: o painel envia o token de sessão do admin (`jv2_admin_auth`) no header `Authorization: Bearer ...`; o Worker valida pela RPC `admin_verificar` do Supabase. **Nenhum segredo de upload fica no front-end.**
4. Preencha `js/r2-config.js`:
   - `R2_WORKER_URL` = URL do Worker
   - `R2_PUBLIC_BASE_URL` = URL pública do bucket

Sem essa configuração, o upload de imagens do painel não funciona (o toast avisa "R2 ainda não configurado").

### 3. Deploy (Vercel)
Mapeie este diretório para a Vercel (ou use `vercel deploy`). O `vercel.json` já configura headers de cache e rewrites (`/login`, `/dashboard`).

## Acesso ao painel
- URL: `/login` ou `/login.html`
- Admin: usuário definido na tabela `admins` (ex.: `cabralsavfer@admin`); a senha é armazenada como SHA-256 no banco, não em `login.html`.

## Fluxo do cliente
1. Loga no site (senha = CNPJ só números). No primeiro acesso o sistema **obriga a troca de senha uma única vez**; depois disso o cliente pode trocar novamente de forma manual em "Alterar senha". Se o admin cadastrar o cliente já com uma senha própria, não há troca obrigatória.
2. Seleciona produtos (preço visível só com login).
3. Checkout com prazo de pagamento → gera orçamento no WhatsApp + salva no Supabase.
4. O orçamento aparece no dashboard em "Orçamentos".
