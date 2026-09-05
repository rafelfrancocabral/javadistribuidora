-- ============================================================
-- Java Distribuidora - Banco de dados Supabase
-- RODAR NO SUPABASE DASHBOARD -> SQL EDITOR
-- Este schema cria as tabelas e politicas RLS usadas pelo site e painel.
-- Depois de rodar, o catalogo e o painel funcionam contra estas tabelas.
-- ============================================================

-- ------------------------------------------------------------
-- Categorias
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.categorias (
    id BIGSERIAL PRIMARY KEY,
    nome TEXT NOT NULL
);

-- ------------------------------------------------------------
-- Subcategorias
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subcategorias (
    id BIGSERIAL PRIMARY KEY,
    nome TEXT NOT NULL,
    categoria TEXT NOT NULL DEFAULT ''
);

-- ------------------------------------------------------------
-- Produtos
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.produtos (
    id BIGSERIAL PRIMARY KEY,
    codigo TEXT UNIQUE,
    nome TEXT NOT NULL,
    marca TEXT DEFAULT '',
    categoria TEXT DEFAULT '',
    subcategoria TEXT,
    preco NUMERIC(12,2) NOT NULL DEFAULT 0,
    unidade TEXT DEFAULT 'UN',
    descricao TEXT DEFAULT '',
    palavraschave JSONB NOT NULL DEFAULT '[]'::jsonb,
    imagens JSONB NOT NULL DEFAULT '[]'::jsonb,
    video TEXT DEFAULT '',
    visivel BOOLEAN NOT NULL DEFAULT true,
    estoque INTEGER NOT NULL DEFAULT 0,
    isdestaque BOOLEAN NOT NULL DEFAULT false,
    ispromocao BOOLEAN NOT NULL DEFAULT false,
    precopromocional NUMERIC(12,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_produtos_codigo ON public.produtos (codigo);
CREATE INDEX IF NOT EXISTS idx_produtos_categoria ON public.produtos (categoria);
CREATE INDEX IF NOT EXISTS idx_produtos_visivel ON public.produtos (visivel);

-- ------------------------------------------------------------
-- Orcamentos (enviados do checkout via WhatsApp)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.orcamentos (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome_cliente TEXT NOT NULL,
    telefone TEXT,
    email TEXT,
    codigo_cliente TEXT,
    codigo_retirada TEXT,
    itens JSONB NOT NULL DEFAULT '[]'::jsonb,
    total NUMERIC(12,2) NOT NULL DEFAULT 0,
    pagamento TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'recebido',
    status_entrega TEXT NOT NULL DEFAULT 'pendente',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Compat com tabelas existentes
ALTER TABLE public.orcamentos ADD COLUMN IF NOT EXISTS pagamento TEXT DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_orcamentos_created ON public.orcamentos (created_at);
CREATE INDEX IF NOT EXISTS idx_orcamentos_status ON public.orcamentos (status);
CREATE INDEX IF NOT EXISTS idx_orcamentos_telefone ON public.orcamentos (telefone);

-- ------------------------------------------------------------
-- Clientes cadastrados pelo dono da loja
-- (somente emails cadastrados podem finalizar o checkout)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.clientes (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    razao_social TEXT NOT NULL,
    cnpj TEXT DEFAULT '',
    email TEXT NOT NULL,
    telefone TEXT DEFAULT '',
    senha TEXT DEFAULT '',
    senha_trocada BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_email ON public.clientes (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_clientes_cnpj ON public.clientes (cnpj);
CREATE INDEX IF NOT EXISTS idx_clientes_razao ON public.clientes (razao_social);

-- Migracao p/ tabelas clientes ja existentes
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS senha TEXT DEFAULT '';
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS senha_trocada BOOLEAN NOT NULL DEFAULT false;

-- ------------------------------------------------------------
-- RLS - libera o acesso via chave anon (uso da aplicacao)
-- ------------------------------------------------------------
ALTER TABLE public.categorias ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='categorias' AND policyname='categorias_all') THEN
        CREATE POLICY categorias_all ON public.categorias FOR ALL USING (true) WITH CHECK (true);
    END IF;
END $$;

ALTER TABLE public.subcategorias ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='subcategorias' AND policyname='subcategorias_all') THEN
        CREATE POLICY subcategorias_all ON public.subcategorias FOR ALL USING (true) WITH CHECK (true);
    END IF;
END $$;

ALTER TABLE public.produtos ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='produtos' AND policyname='produtos_all') THEN
        CREATE POLICY produtos_all ON public.produtos FOR ALL USING (true) WITH CHECK (true);
    END IF;
END $$;

ALTER TABLE public.orcamentos ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='orcamentos' AND policyname='orcamentos_all') THEN
        CREATE POLICY orcamentos_all ON public.orcamentos FOR ALL USING (true) WITH CHECK (true);
    END IF;
END $$;

ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='clientes' AND policyname='clientes_all') THEN
        CREATE POLICY clientes_all ON public.clientes FOR ALL USING (true) WITH CHECK (true);
    END IF;
END $$;