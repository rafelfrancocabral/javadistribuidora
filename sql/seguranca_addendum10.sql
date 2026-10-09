-- ============================================================================
-- Addendum 10:
--  A) Tracker: registro de atividades (texto + data) do painel.
--  B) Metas: passa a permitir meta por PRODUTO (unidades) e por CLIENTE (R$),
--     mantendo as metas mensais de venda (tipo='mensal').
-- ============================================================================

-- ============================================================================
-- A) TRACKER
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.tracker (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    texto      text NOT NULL,
    admin_id   bigint REFERENCES public.admins(id) ON DELETE SET NULL,
    criado_em  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tracker ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tracker FROM anon;

-- Lista as atividades (mais recentes primeiro).
CREATE OR REPLACE FUNCTION public.admin_listar_tracker(_token text)
RETURNS TABLE (id bigint, texto text, admin_id bigint, criado_em timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF public.admin_requerido(_token) IS NULL THEN
        RAISE EXCEPTION 'Nao autorizado' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
      SELECT t.id, t.texto, t.admin_id, t.criado_em
      FROM public.tracker t
      ORDER BY t.criado_em DESC, t.id DESC
      LIMIT 200;
END;
$$;

-- Registra uma atividade/anotacao manual.
CREATE OR REPLACE FUNCTION public.admin_registrar_tracker(_token text, _texto text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _admin_id bigint;
DECLARE _ret bigint;
BEGIN
    _admin_id := public.admin_requerido(_token);
    IF _admin_id IS NULL THEN
        RAISE EXCEPTION 'Nao autorizado' USING ERRCODE = '42501';
    END IF;
    _texto := trim(coalesce(_texto, ''));
    IF _texto = '' THEN
        RAISE EXCEPTION 'Texto vazio' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.tracker (texto, admin_id)
    VALUES (left(_texto, 300), _admin_id)
    RETURNING id INTO _ret;
    RETURN _ret;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_listar_tracker(text)       FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_registrar_tracker(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_listar_tracker(text)       TO anon;
GRANT EXECUTE ON FUNCTION public.admin_registrar_tracker(text, text) TO anon;

-- ============================================================================
-- B) METAS: tipos mensal / produto / cliente
-- ============================================================================
ALTER TABLE public.metas
    ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'mensal',
    ADD COLUMN IF NOT EXISTS produto_id bigint REFERENCES public.produtos(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS cliente_id bigint REFERENCES public.clientes(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS unidades integer;

ALTER TABLE public.metas
    DROP CONSTRAINT IF EXISTS metas_tipo_check,
    ADD CONSTRAINT metas_tipo_check CHECK (tipo IN ('mensal', 'produto', 'cliente'));

-- Uma meta unica por (linha, mes, tipo, produto/cliente).
DROP INDEX IF EXISTS idx_metas_linha_mes;
CREATE UNIQUE INDEX IF NOT EXISTS idx_metas_unica
    ON public.metas (linha, mes, tipo, produto_id, cliente_id) NULLS NOT DISTINCT;

-- Lista todas as metas (inclui tipo/produto/cliente/unidades).
DROP FUNCTION IF EXISTS public.admin_listar_metas(text);
CREATE OR REPLACE FUNCTION public.admin_listar_metas(_token text)
RETURNS TABLE (id bigint, linha text, mes date, valor numeric,
               tipo text, produto_id bigint, cliente_id bigint, unidades integer,
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
      SELECT m.id, m.linha, m.mes, m.valor, m.tipo,
             m.produto_id, m.cliente_id, m.unidades, m.created_at, m.updated_at
      FROM public.metas m
      ORDER BY m.mes DESC, m.linha, m.tipo;
END;
$$;

-- Cria/atualiza meta. Tipos:
--   'mensal'  -> valor R$ por mes/linha
--   'produto' -> unidades do produto (_produto_id) no mes
--   'cliente' -> valor R$ de vendas do cliente (_cliente_id) no mes
DROP FUNCTION IF EXISTS public.admin_salvar_meta(text, text, text, numeric, bigint);
CREATE OR REPLACE FUNCTION public.admin_salvar_meta(
    _token text, _linha text, _mes text, _valor numeric, _id bigint DEFAULT NULL,
    _tipo text DEFAULT 'mensal', _produto_id bigint DEFAULT NULL,
    _cliente_id bigint DEFAULT NULL, _unidades integer DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _ret bigint;
DECLARE _mesd date;
BEGIN
    IF public.admin_requerido(_token) IS NULL THEN
        RAISE EXCEPTION 'Nao autorizado' USING ERRCODE = '42501';
    END IF;
    IF _linha NOT IN ('java', 'dymar') THEN
        RAISE EXCEPTION 'Linha invalida' USING ERRCODE = '22023';
    END IF;
    _mesd := to_date(coalesce(_mes, ''), 'YYYY-MM');
    IF _mesd IS NULL THEN
        RAISE EXCEPTION 'Mes invalido' USING ERRCODE = '22023';
    END IF;
    IF _tipo NOT IN ('mensal', 'produto', 'cliente') THEN
        RAISE EXCEPTION 'Tipo de meta invalido' USING ERRCODE = '22023';
    END IF;
    IF _tipo = 'produto' AND _produto_id IS NULL THEN
        RAISE EXCEPTION 'Selecione o produto' USING ERRCODE = '22023';
    END IF;
    IF _tipo = 'cliente' AND _cliente_id IS NULL THEN
        RAISE EXCEPTION 'Selecione o cliente' USING ERRCODE = '22023';
    END IF;
    IF _id IS NULL THEN
        INSERT INTO public.metas (linha, mes, valor, tipo, produto_id, cliente_id, unidades)
        VALUES (_linha, _mesd, coalesce(_valor, 0), _tipo, _produto_id, _cliente_id, _unidades)
        ON CONFLICT (linha, mes, tipo, produto_id, cliente_id)
        DO UPDATE SET
            valor = excluded.valor,
            unidades = excluded.unidades,
            updated_at = now()
        RETURNING id INTO _ret;
    ELSE
        UPDATE public.metas
           SET linha = _linha, mes = _mesd, valor = coalesce(_valor, 0),
               tipo = _tipo, produto_id = _produto_id, cliente_id = _cliente_id,
               unidades = _unidades, updated_at = now()
         WHERE id = _id
         RETURNING id INTO _ret;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Meta nao encontrada' USING ERRCODE = 'P0002';
        END IF;
    END IF;
    RETURN _ret;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_excluir_meta(_token text, _id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF public.admin_requerido(_token) IS NULL THEN
        RAISE EXCEPTION 'Nao autorizado' USING ERRCODE = '42501';
    END IF;
    DELETE FROM public.metas WHERE id = _id;
    RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_listar_metas(text)                                  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_salvar_meta(text, text, text, numeric, bigint, text, bigint, bigint, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_excluir_meta(text, bigint)                          FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_listar_metas(text)                                  TO anon;
GRANT EXECUTE ON FUNCTION public.admin_salvar_meta(text, text, text, numeric, bigint, text, bigint, bigint, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_excluir_meta(text, bigint)                          TO anon;