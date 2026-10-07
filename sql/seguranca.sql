-- ============================================================================
-- Java Distribuidora - Seguranca: RLS + login por funcoes RPC
-- ============================================================================
-- ANTES DE RODAR:
--  1) Abra o SQL Editor do Supabase (Dashboard > SQL Editor > New query).
--  2) Cole TODO este arquivo e execute (Run).
--  3) Depois, defina a senha do admin (instrucoes no final deste arquivo).
-- OBS: execute o arquivo INTEIRO. As funcoes dependem umas das outras.
-- ============================================================================

BEGIN;

-- gen_random_bytes() usado nas sessoes (ja instalado no Supabase por padrao)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- 1) HABILITA ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
ALTER TABLE public.produtos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categorias    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subcategorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orcamentos    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visitas       ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 2) POLITICAS: catalogo publico e apenas leitura
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS produtos_select ON public.produtos;
CREATE POLICY produtos_select ON public.produtos FOR SELECT USING (true);

DROP POLICY IF EXISTS categorias_select ON public.categorias;
CREATE POLICY categorias_select ON public.categorias FOR SELECT USING (true);

DROP POLICY IF EXISTS subcategorias_select ON public.subcategorias;
CREATE POLICY subcategorias_select ON public.subcategorias FOR SELECT USING (true);

-- ----------------------------------------------------------------------------
-- 3) REVOGA ACESSO DIRETO ANONIMO (todas as escritas e leituras sensiveis)
--    Nada disso vale para as funcoes SECURITY DEFINER abaixo.
-- ----------------------------------------------------------------------------
REVOKE ALL ON public.produtos      FROM anon;
REVOKE ALL ON public.categorias    FROM anon;
REVOKE ALL ON public.subcategorias FROM anon;
REVOKE ALL ON public.clientes      FROM anon;
REVOKE ALL ON public.orcamentos    FROM anon;
REVOKE ALL ON public.visitas       FROM anon;

-- mantem a leitura publica apenas do catalogo
GRANT SELECT ON public.produtos      TO anon;
GRANT SELECT ON public.categorias    TO anon;
GRANT SELECT ON public.subcategorias TO anon;

-- preco de custo e uso interno: anon nao pode ler essa coluna (so via RPC admin)
REVOKE SELECT (preco_custo) ON public.produtos FROM anon;

-- ----------------------------------------------------------------------------
-- 4) TABELAS DE ADMINISTRACAO (so o dono acessa; anon bloqueado acima)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admins (
    id          bigserial PRIMARY KEY,
    usuario     text NOT NULL UNIQUE,
    nome        text NOT NULL DEFAULT '',
    senha_hash  text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.admin_sessions (
    token      text PRIMARY KEY,
    admin_id   bigint NOT NULL REFERENCES public.admins(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS admin_sessions_expires_idx ON public.admin_sessions(expires_at);

-- anon nao acessa as tabelas de administracao (so via funcoes com token)
REVOKE ALL ON public.admins         FROM anon;
REVOKE ALL ON public.admin_sessions FROM anon;

-- ----------------------------------------------------------------------------
-- 5) FUNCOES DE SESSAO
-- ----------------------------------------------------------------------------

-- Verifica se o token e valido; retorna o id do admin ou NULL.
CREATE OR REPLACE FUNCTION public.admin_requerido(_token text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _admin_id bigint;
BEGIN
    DELETE FROM public.admin_sessions WHERE expires_at <= now();
    SELECT admin_id INTO _admin_id FROM public.admin_sessions WHERE token = _token AND expires_at > now();
    RETURN _admin_id;
END;
$$;

-- Cria uma sessao e devolve o token.
CREATE OR REPLACE FUNCTION public.criar_sessao_admin(_admin_id bigint)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _token text;
BEGIN
    _token := encode(extensions.gen_random_bytes(24), 'hex');
    INSERT INTO public.admin_sessions (token, admin_id, expires_at)
    VALUES (_token, _admin_id, now() + interval '12 hours');
    RETURN _token;
END;
$$;

-- Login do painel: valida usuario e hash da senha.
CREATE OR REPLACE FUNCTION public.admin_autenticar(_usuario text, _senha_hash text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _row public.admins%ROWTYPE;
BEGIN
    SELECT * INTO _row FROM public.admins WHERE usuario = _usuario;
    IF NOT FOUND OR _row.senha_hash IS DISTINCT FROM _senha_hash THEN
        RAISE EXCEPTION 'Usuario ou senha invalidos' USING ERRCODE = '28P01';
    END IF;
    RETURN public.criar_sessao_admin(_row.id);
END;
$$;

-- Usado pelo painel para confirmar sessao ativa.
CREATE OR REPLACE FUNCTION public.admin_verificar(_token text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.admin_requerido(_token) IS NOT NULL;
$$;

-- ----------------------------------------------------------------------------
-- 6) CLIENTES DO SITE
-- ----------------------------------------------------------------------------

-- Login do cliente: identifica por email OU cnpj. Nunca devolve o hash.
-- O navegador envia dois hashes: sha256(senha) e sha256(senha-somente-numeros).
CREATE OR REPLACE FUNCTION public.verificar_login(_identificador text, _senha_email text, _senha_cnpj text)
RETURNS TABLE (id bigint, razao_social text, email text, senha_trocada boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _row public.clientes%ROWTYPE;
DECLARE _digits text;
BEGIN
    _digits := regexp_replace(coalesce(_identificador, ''), '\D', '', 'g');

    SELECT * INTO _row FROM public.clientes
     WHERE lower(email) = lower(coalesce(_identificador, ''))
     ORDER BY id LIMIT 1;

    IF NOT FOUND AND _digits <> '' THEN
        SELECT * INTO _row FROM public.clientes
         WHERE regexp_replace(coalesce(cnpj, ''), '\D', '', 'g') = _digits
         ORDER BY id LIMIT 1;
        IF FOUND THEN
            IF _row.senha IS DISTINCT FROM _senha_cnpj THEN
                RAISE EXCEPTION 'Senha incorreta' USING ERRCODE = '28P01';
            END IF;
            RETURN QUERY SELECT _row.id, _row.razao_social, _row.email, coalesce(_row.senha_trocada, false);
            RETURN;
        END IF;
    END IF;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cliente nao cadastrado. Contate a loja.' USING ERRCODE = '28P01';
    END IF;
    IF _row.senha IS DISTINCT FROM _senha_email THEN
        RAISE EXCEPTION 'Senha incorreta' USING ERRCODE = '28P01';
    END IF;
    RETURN QUERY SELECT _row.id, _row.razao_social, _row.email, coalesce(_row.senha_trocada, false);
END;
$$;

-- Troca de senha do cliente: valida a senha atual no servidor.
CREATE OR REPLACE FUNCTION public.alterar_senha(_id bigint, _antiga_hash text, _nova_hash text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _row public.clientes%ROWTYPE;
BEGIN
    SELECT * INTO _row FROM public.clientes WHERE id = _id;
    IF NOT FOUND OR _row.senha IS DISTINCT FROM _antiga_hash THEN
        RAISE EXCEPTION 'Senha atual incorreta' USING ERRCODE = '28P01';
    END IF;
    IF length(coalesce(_nova_hash, '')) < 40 THEN
        RAISE EXCEPTION 'Nova senha invalida' USING ERRCODE = '22023';
    END IF;
    UPDATE public.clientes SET senha = _nova_hash, senha_trocada = true, updated_at = now() WHERE id = _id;
    RETURN true;
END;
$$;

-- ----------------------------------------------------------------------------
-- 7) PAINEL ADMIN - CLIENTES
-- ----------------------------------------------------------------------------

-- Lista clientes SEM o hash de senha.
CREATE OR REPLACE FUNCTION public.admin_listar_clientes(_token text)
RETURNS TABLE (id bigint, razao_social text, cnpj text, email text, telefone text,
               senha_trocada boolean, senha_padrao boolean, created_at timestamptz, updated_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF public.admin_requerido(_token) IS NULL THEN
        RAISE EXCEPTION 'Nao autorizado' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
      SELECT c.id, c.razao_social, c.cnpj, c.email, c.telefone,
             coalesce(c.senha_trocada, false),
             (c.senha IS NOT NULL AND NOT coalesce(c.senha_trocada, false)),
             c.created_at, c.updated_at
      FROM public.clientes c
      ORDER BY c.razao_social ASC;
END;
$$;

-- Insere ou atualiza um cliente. _cliente chaves:
--   id (opcional), razao_social, cnpj, email, telefone,
--   senha (hash opcional; em edicao, vazio = mantem atual),
--   trocar (boolean), novo (boolean)
CREATE OR REPLACE FUNCTION public.admin_salvar_cliente(_token text, _cliente jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _id bigint;
DECLARE _senha_hash text;
DECLARE _nova boolean := coalesce((_cliente->>'novo')::boolean, false);
BEGIN
    IF public.admin_requerido(_token) IS NULL THEN
        RAISE EXCEPTION 'Nao autorizado' USING ERRCODE = '42501';
    END IF;
    _id := (_cliente->>'id')::bigint;

    IF _nova THEN
        _senha_hash := nullif(_cliente->>'senha', '');
        IF _senha_hash IS NULL THEN
            _senha_hash := regexp_replace(coalesce(_cliente->>'cnpj', ''), '\D', '', 'g');
        END IF;
        IF _senha_hash = '' THEN
            RAISE EXCEPTION 'Informe uma senha ou preencha o CNPJ' USING ERRCODE = '22023';
        END IF;
        INSERT INTO public.clientes (razao_social, cnpj, email, telefone, senha,
                                     senha_trocada, created_at, updated_at)
        VALUES (coalesce(_cliente->>'razao_social', ''), _cliente->>'cnpj', lower(_cliente->>'email'),
                _cliente->>'telefone', _senha_hash,
                coalesce((_cliente->>'trocar')::boolean, true), now(), now())
        RETURNING id INTO _id;
    ELSE
        IF _id IS NULL THEN
            RAISE EXCEPTION 'Cliente sem id para edicao' USING ERRCODE = '22023';
        END IF;
        _senha_hash := nullif(_cliente->>'senha', '');
        IF _senha_hash IS NOT NULL THEN
            UPDATE public.clientes
               SET razao_social = coalesce(_cliente->>'razao_social', razao_social),
                   cnpj = _cliente->>'cnpj',
                   email = lower(_cliente->>'email'),
                   telefone = _cliente->>'telefone',
                   senha = _senha_hash,
                   senha_trocada = coalesce((_cliente->>'trocar')::boolean, senha_trocada),
                   updated_at = now()
             WHERE id = _id;
        ELSE
            UPDATE public.clientes
               SET razao_social = coalesce(_cliente->>'razao_social', razao_social),
                   cnpj = _cliente->>'cnpj',
                   email = lower(_cliente->>'email'),
                   telefone = _cliente->>'telefone',
                   senha_trocada = coalesce((_cliente->>'trocar')::boolean, senha_trocada),
                   updated_at = now()
             WHERE id = _id;
        END IF;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Cliente nao encontrado' USING ERRCODE = 'P0002';
        END IF;
    END IF;
    RETURN _id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_excluir_cliente(_token text, _id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF public.admin_requerido(_token) IS NULL THEN
        RAISE EXCEPTION 'Nao autorizado' USING ERRCODE = '42501';
    END IF;
    DELETE FROM public.clientes WHERE id = _id;
    RETURN TRUE;
END;
$$;

-- ----------------------------------------------------------------------------
-- 8) ORCAMENTOS
-- ----------------------------------------------------------------------------

-- Site publico: cria um orcamento (o numero/codigos sao gerados pelo site).
CREATE OR REPLACE FUNCTION public.criar_orcamento(_payload jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _id bigint;
BEGIN
    INSERT INTO public.orcamentos
        (nome_cliente, telefone, email, codigo_cliente, codigo_retirada, itens,
         total, pagamento, status, status_entrega, linha, created_at, updated_at)
    VALUES
        (coalesce(_payload->>'nome_cliente', ''), coalesce(_payload->>'telefone', ''),
         coalesce(_payload->>'email', ''), coalesce(_payload->>'codigo_cliente', ''),
         coalesce(_payload->>'codigo_retirada', ''), coalesce(_payload->'itens', '[]'::jsonb),
         coalesce((_payload->>'total')::numeric, 0), coalesce(_payload->>'pagamento', ''),
         coalesce(_payload->>'status', 'recebido'), coalesce(_payload->>'status_entrega', 'pendente'),
         coalesce(_payload->>'linha', 'java'), now(), now())
    RETURNING id INTO _id;
    RETURN _id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_listar_orcamentos(_token text)
RETURNS TABLE (id bigint, nome_cliente text, telefone text, email text,
               codigo_cliente text, codigo_retirada text, itens jsonb, total numeric,
               pagamento text, status text, status_entrega text, linha text,
               created_at timestamptz, updated_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF public.admin_requerido(_token) IS NULL THEN
        RAISE EXCEPTION 'Nao autorizado' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
      SELECT o.id, o.nome_cliente, o.telefone, o.email, o.codigo_cliente,
             o.codigo_retirada, o.itens, o.total, o.pagamento, o.status,
             o.status_entrega, o.linha, o.created_at, o.updated_at
      FROM public.orcamentos o
      ORDER BY o.created_at DESC;
END;
$$;

-- Insere (sem id) ou atualiza um orcamento do painel.
CREATE OR REPLACE FUNCTION public.admin_salvar_orcamento(_token text, _payload jsonb, _id bigint DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _ret bigint;
BEGIN
    IF public.admin_requerido(_token) IS NULL THEN
        RAISE EXCEPTION 'Nao autorizado' USING ERRCODE = '42501';
    END IF;
    IF _id IS NULL THEN
        INSERT INTO public.orcamentos
            (nome_cliente, telefone, email, codigo_cliente, codigo_retirada, itens,
             total, pagamento, status, status_entrega, linha, created_at, updated_at)
        VALUES
            (coalesce(_payload->>'nome_cliente', ''), coalesce(_payload->>'telefone', ''),
             coalesce(_payload->>'email', ''), coalesce(_payload->>'codigo_cliente', ''),
             coalesce(_payload->>'codigo_retirada', ''), coalesce(_payload->'itens', '[]'::jsonb),
             coalesce((_payload->>'total')::numeric, 0), coalesce(_payload->>'pagamento', ''),
             coalesce(_payload->>'status', 'recebido'), coalesce(_payload->>'status_entrega', 'pendente'),
             coalesce(_payload->>'linha', 'java'), now(), now())
        RETURNING id INTO _ret;
    ELSE
        UPDATE public.orcamentos
           SET nome_cliente = coalesce(_payload->>'nome_cliente', nome_cliente),
               telefone = coalesce(_payload->>'telefone', telefone),
               email = coalesce(_payload->>'email', email),
               itens = coalesce(_payload->'itens', itens),
               total = coalesce((_payload->>'total')::numeric, total),
               pagamento = coalesce(_payload->>'pagamento', pagamento),
               linha = coalesce(_payload->>'linha', linha),
               updated_at = now()
         WHERE id = _id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Orcamento nao encontrado' USING ERRCODE = 'P0002';
        END IF;
        _ret := _id;
    END IF;
    RETURN _ret;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_atualizar_status_orcamento(
    _token text, _id bigint, _status text, _status_entrega text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF public.admin_requerido(_token) IS NULL THEN
        RAISE EXCEPTION 'Nao autorizado' USING ERRCODE = '42501';
    END IF;
    IF _status_entrega IS NULL THEN
        UPDATE public.orcamentos SET status = _status, updated_at = now() WHERE id = _id;
    ELSE
        UPDATE public.orcamentos SET status = _status, status_entrega = _status_entrega, updated_at = now() WHERE id = _id;
    END IF;
    RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_excluir_orcamento(_token text, _id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF public.admin_requerido(_token) IS NULL THEN
        RAISE EXCEPTION 'Nao autorizado' USING ERRCODE = '42501';
    END IF;
    DELETE FROM public.orcamentos WHERE id = _id;
    RETURN TRUE;
END;
$$;

-- ----------------------------------------------------------------------------
-- 9) VISITAS
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_listar_visitas(_token text)
RETURNS TABLE (id bigint, razao_social text, email text, telefone text, data date,
               hora text, rota text, observacoes text, status text,
               created_at timestamptz, updated_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF public.admin_requerido(_token) IS NULL THEN
        RAISE EXCEPTION 'Nao autorizado' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
      SELECT v.id, v.razao_social, v.email, v.telefone, v.data, v.hora, v.rota,
             v.observacoes, v.status, v.created_at, v.updated_at
      FROM public.visitas v
      ORDER BY v.data ASC, v.hora ASC NULLS LAST;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_salvar_visita(_token text, _payload jsonb, _id bigint DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _ret bigint;
BEGIN
    IF public.admin_requerido(_token) IS NULL THEN
        RAISE EXCEPTION 'Nao autorizado' USING ERRCODE = '42501';
    END IF;
    IF _id IS NULL THEN
        INSERT INTO public.visitas
            (razao_social, email, telefone, data, hora, rota, observacoes, status, created_at, updated_at)
        VALUES
            (coalesce(_payload->>'razao_social', ''), coalesce(_payload->>'email', ''),
             coalesce(_payload->>'telefone', ''), coalesce((_payload->>'data')::date, CURRENT_DATE),
             coalesce(_payload->>'hora', ''), coalesce(_payload->>'rota', ''),
             coalesce(_payload->>'observacoes', ''), coalesce(_payload->>'status', 'agendada'),
             now(), now())
        RETURNING id INTO _ret;
    ELSE
        UPDATE public.visitas
           SET razao_social = coalesce(_payload->>'razao_social', razao_social),
               email = coalesce(_payload->>'email', email),
               telefone = coalesce(_payload->>'telefone', telefone),
               data = coalesce((_payload->>'data')::date, data),
               hora = coalesce(_payload->>'hora', hora),
               rota = coalesce(_payload->>'rota', rota),
               observacoes = coalesce(_payload->>'observacoes', observacoes),
               updated_at = now()
         WHERE id = _id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Visita nao encontrada' USING ERRCODE = 'P0002';
        END IF;
        _ret := _id;
    END IF;
    RETURN _ret;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_status_visita(_token text, _id bigint, _status text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF public.admin_requerido(_token) IS NULL THEN
        RAISE EXCEPTION 'Nao autorizado' USING ERRCODE = '42501';
    END IF;
    UPDATE public.visitas SET status = _status, updated_at = now() WHERE id = _id;
    RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_excluir_visita(_token text, _id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF public.admin_requerido(_token) IS NULL THEN
        RAISE EXCEPTION 'Nao autorizado' USING ERRCODE = '42501';
    END IF;
    DELETE FROM public.visitas WHERE id = _id;
    RETURN TRUE;
END;
$$;

-- ----------------------------------------------------------------------------
-- 10) PRODUTOS (escritas do painel + importacao)
-- ----------------------------------------------------------------------------

-- Lista produtos com dados completos (usa o token; preco_custo fica protegido).
CREATE OR REPLACE FUNCTION public.admin_listar_produtos(_token text)
RETURNS TABLE (id bigint, codigo text, nome text, marca text, categoria text,
               subcategoria text, unidade text, preco numeric, preco_custo numeric,
               estoque integer, icmsst numeric, embalagem numeric, descricao text,
               palavraschave jsonb, imagens jsonb, isdestaque boolean, ispromocao boolean,
               precopromocional numeric, somente_orcamento boolean, visivel boolean,
               linha text, created_at timestamptz, updated_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF public.admin_requerido(_token) IS NULL THEN
        RAISE EXCEPTION 'Nao autorizado' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY SELECT p.id, p.codigo, p.nome, p.marca, p.categoria, p.subcategoria,
                        p.unidade, p.preco, p.preco_custo, p.estoque, p.icmsst,
                        p.embalagem, p.descricao, p.palavraschave, p.imagens,
                        p.isdestaque, p.ispromocao, p.precopromocional,
                        p.somente_orcamento, p.visivel, p.linha, p.created_at, p.updated_at
                 FROM public.produtos p
                 ORDER BY p.id ASC;
END;
$$;

-- Insere ou atualiza um produto. _payload usa os nomes das colunas.
-- Se tiver "id" e o registro existir: atualiza; senao: insere.
CREATE OR REPLACE FUNCTION public.admin_salvar_produto(_token text, _payload jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _id bigint;
BEGIN
    IF public.admin_requerido(_token) IS NULL THEN
        RAISE EXCEPTION 'Nao autorizado' USING ERRCODE = '42501';
    END IF;
    _id := (_payload->>'id')::bigint;

    IF _id IS NOT NULL THEN
        UPDATE public.produtos SET
            codigo = coalesce(_payload->>'codigo', codigo),
            nome = coalesce(_payload->>'nome', nome),
            marca = coalesce(_payload->>'marca', marca),
            categoria = coalesce(_payload->>'categoria', categoria),
            subcategoria = CASE WHEN _payload ? 'subcategoria' THEN _payload->>'subcategoria' ELSE subcategoria END,
            unidade = coalesce(_payload->>'unidade', unidade),
            preco = coalesce((_payload->>'preco')::numeric, preco),
            preco_custo = coalesce((_payload->>'preco_custo')::numeric, preco_custo),
            estoque = coalesce((_payload->>'estoque')::integer, estoque),
            icmsst = coalesce((_payload->>'icmsst')::numeric, icmsst),
            embalagem = coalesce((_payload->>'embalagem')::integer, embalagem),
            descricao = coalesce(_payload->>'descricao', descricao),
            palavraschave = coalesce(_payload->'palavraschave', palavraschave),
            imagens = coalesce(_payload->'imagens', imagens),
            isdestaque = coalesce((_payload->>'isdestaque')::boolean, isdestaque),
            ispromocao = coalesce((_payload->>'ispromocao')::boolean, ispromocao),
            precopromocional = coalesce((_payload->>'precopromocional')::numeric, precopromocional),
            somente_orcamento = coalesce((_payload->>'somente_orcamento')::boolean, somente_orcamento),
            visivel = coalesce((_payload->>'visivel')::boolean, visivel),
            linha = coalesce(_payload->>'linha', linha),
            updated_at = now()
        WHERE id = _id;
        IF FOUND THEN
            RETURN _id;
        END IF;
    END IF;

    INSERT INTO public.produtos
        (codigo, nome, marca, categoria, subcategoria, unidade, preco, preco_custo,
         estoque, icmsst, embalagem, descricao, palavraschave, imagens, isdestaque,
         ispromocao, precopromocional, somente_orcamento, visivel, linha, created_at, updated_at)
    VALUES
        (coalesce(_payload->>'codigo', 'generated-' || floor(random() * 1000000)::int::text),
         coalesce(_payload->>'nome', 'Sem nome'), coalesce(_payload->>'marca', ''),
         coalesce(_payload->>'categoria', ''), _payload->>'subcategoria',
         coalesce(_payload->>'unidade', 'UN'), coalesce((_payload->>'preco')::numeric, 0),
         coalesce((_payload->>'preco_custo')::numeric, 0),
         coalesce((_payload->>'estoque')::integer, 0), coalesce((_payload->>'icmsst')::numeric, 0),
         coalesce((_payload->>'embalagem')::integer, 1), coalesce(_payload->>'descricao', ''),
         coalesce(_payload->'palavraschave', '[]'::jsonb), coalesce(_payload->'imagens', '[]'::jsonb),
         coalesce((_payload->>'isdestaque')::boolean, false),
         coalesce((_payload->>'ispromocao')::boolean, false),
         coalesce((_payload->>'precopromocional')::numeric, 0),
         coalesce((_payload->>'somente_orcamento')::boolean, false),
         coalesce((_payload->>'visivel')::boolean, true),
         coalesce(_payload->>'linha', 'java'), now(), now())
    RETURNING id INTO _id;
    RETURN _id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_toggle_produto(_token text, _id bigint, _visivel boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF public.admin_requerido(_token) IS NULL THEN
        RAISE EXCEPTION 'Nao autorizado' USING ERRCODE = '42501';
    END IF;
    UPDATE public.produtos SET visivel = _visivel, updated_at = now() WHERE id = _id;
    RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_excluir_produto(_token text, _id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF public.admin_requerido(_token) IS NULL THEN
        RAISE EXCEPTION 'Nao autorizado' USING ERRCODE = '42501';
    END IF;
    DELETE FROM public.produtos WHERE id = _id;
    RETURN TRUE;
END;
$$;

-- ----------------------------------------------------------------------------
-- 11) CATEGORIAS E SUBCATEGORIAS (escritas do painel)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_salvar_categoria(_token text, _nome text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _id bigint;
BEGIN
    IF public.admin_requerido(_token) IS NULL THEN
        RAISE EXCEPTION 'Nao autorizado' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.categorias (nome) VALUES (_nome) RETURNING id INTO _id;
    RETURN _id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_excluir_categoria(_token text, _id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF public.admin_requerido(_token) IS NULL THEN
        RAISE EXCEPTION 'Nao autorizado' USING ERRCODE = '42501';
    END IF;
    DELETE FROM public.categorias WHERE id = _id;
    RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_salvar_subcategoria(_token text, _nome text, _categoria text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _id bigint;
BEGIN
    IF public.admin_requerido(_token) IS NULL THEN
        RAISE EXCEPTION 'Nao autorizado' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.subcategorias (nome, categoria) VALUES (_nome, _categoria) RETURNING id INTO _id;
    RETURN _id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_excluir_subcategoria(_token text, _id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF public.admin_requerido(_token) IS NULL THEN
        RAISE EXCEPTION 'Nao autorizado' USING ERRCODE = '42501';
    END IF;
    DELETE FROM public.subcategorias WHERE id = _id;
    RETURN TRUE;
END;
$$;

-- ----------------------------------------------------------------------------
-- 12) PERMISSOES DAS FUNCOES (release: execucao publica bloqueada; so anon)
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.admin_requerido            FROM PUBLIC;
REVOKE ALL ON FUNCTION public.criar_sessao_admin         FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_autenticar           FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_verificar            FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verificar_login            FROM PUBLIC;
REVOKE ALL ON FUNCTION public.alterar_senha              FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_listar_clientes      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_salvar_cliente       FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_excluir_cliente      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.criar_orcamento            FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_listar_orcamentos    FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_salvar_orcamento     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_atualizar_status_orcamento FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_excluir_orcamento    FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_listar_visitas       FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_salvar_visita        FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_status_visita    FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_excluir_visita       FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_salvar_produto       FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_listar_produtos      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_toggle_produto       FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_excluir_produto      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_salvar_categoria     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_excluir_categoria    FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_salvar_subcategoria  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_excluir_subcategoria FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_requerido            TO anon;
GRANT EXECUTE ON FUNCTION public.criar_sessao_admin         TO anon;
GRANT EXECUTE ON FUNCTION public.admin_autenticar           TO anon;
GRANT EXECUTE ON FUNCTION public.admin_verificar            TO anon;
GRANT EXECUTE ON FUNCTION public.verificar_login            TO anon;
GRANT EXECUTE ON FUNCTION public.alterar_senha              TO anon;
GRANT EXECUTE ON FUNCTION public.admin_listar_clientes      TO anon;
GRANT EXECUTE ON FUNCTION public.admin_salvar_cliente       TO anon;
GRANT EXECUTE ON FUNCTION public.admin_excluir_cliente      TO anon;
GRANT EXECUTE ON FUNCTION public.criar_orcamento            TO anon;
GRANT EXECUTE ON FUNCTION public.admin_listar_orcamentos    TO anon;
GRANT EXECUTE ON FUNCTION public.admin_salvar_orcamento     TO anon;
GRANT EXECUTE ON FUNCTION public.admin_atualizar_status_orcamento TO anon;
GRANT EXECUTE ON FUNCTION public.admin_excluir_orcamento    TO anon;
GRANT EXECUTE ON FUNCTION public.admin_listar_visitas       TO anon;
GRANT EXECUTE ON FUNCTION public.admin_salvar_visita        TO anon;
GRANT EXECUTE ON FUNCTION public.admin_set_status_visita    TO anon;
GRANT EXECUTE ON FUNCTION public.admin_excluir_visita       TO anon;
GRANT EXECUTE ON FUNCTION public.admin_salvar_produto       TO anon;
GRANT EXECUTE ON FUNCTION public.admin_listar_produtos      TO anon;
GRANT EXECUTE ON FUNCTION public.admin_toggle_produto       TO anon;
GRANT EXECUTE ON FUNCTION public.admin_excluir_produto      TO anon;
GRANT EXECUTE ON FUNCTION public.admin_salvar_categoria     TO anon;
GRANT EXECUTE ON FUNCTION public.admin_excluir_categoria    TO anon;
GRANT EXECUTE ON FUNCTION public.admin_salvar_subcategoria  TO anon;
GRANT EXECUTE ON FUNCTION public.admin_excluir_subcategoria TO anon;

-- ----------------------------------------------------------------------------
-- 13) ADMIN INICIAL (placeholder - VOCE DEFINE A SENHA)
-- ----------------------------------------------------------------------------
INSERT INTO public.admins (usuario, nome, senha_hash)
VALUES ('cabralsavfer@admin', 'Administrador', 'TROQUE_AQUI_SHA256_DA_SENHA')
ON CONFLICT (usuario) DO NOTHING;

COMMIT;

-- ============================================================================
-- DEPOIS DE RODAR: defina a senha REAL do admin
-- ============================================================================
-- 1) Calcule o SHA-256 da senha escolhida (64 caracteres hex). No SQL Editor:
--        select encode(sha256('SUA_SENHA'::bytea), 'hex');
-- 2) Exemplo (senha sugerida "Cabral@Seguro2026"):
--        update public.admins set senha_hash = '9fd6b12bcb7c2a4680c943e3e65ccbc28d69fe40cd9e6d4d24ef21525ad6bd5b'
--          where usuario = 'cabralsavfer@admin';
--    (troque pelo hash da senha que voce escolher)
-- 3) (Cloudflare) Secret do upload de imagens: crie/atualize a variavel
--    UPLOAD_SECRET do Worker com o valor que estiver em js/r2-config.js,
--    e faça o redeploy do Worker (worker/r2-uploader.js).
-- ============================================================================