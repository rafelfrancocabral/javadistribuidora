-- ============================================================================
-- Addendum 19:
--   Metas por CATEGORIA (faturamento em R$ no mes).
--   - Adiciona a coluna categoria em public.metas.
--   - Passa a aceitar o tipo 'categoria'.
--   - admin_salvar_meta passa a aceitar _categoria.
--   - admin_listar_metas passa a retornar categoria.
-- ============================================================================

ALTER TABLE public.metas
    ADD COLUMN IF NOT EXISTS categoria text;

ALTER TABLE public.metas
    DROP CONSTRAINT IF EXISTS metas_tipo_check,
    ADD CONSTRAINT metas_tipo_check CHECK (tipo IN ('mensal', 'produto', 'cliente', 'categoria'));

-- Uma meta unica por (linha, mes, tipo, produto/cliente/categoria).
DROP INDEX IF EXISTS idx_metas_unica;
CREATE UNIQUE INDEX IF NOT EXISTS idx_metas_unica
    ON public.metas (linha, mes, tipo, produto_id, cliente_id, categoria) NULLS NOT DISTINCT;

-- Lista todas as metas (inclui categoria).
DROP FUNCTION IF EXISTS public.admin_listar_metas(text);
CREATE OR REPLACE FUNCTION public.admin_listar_metas(_token text)
RETURNS TABLE (id bigint, linha text, mes date, valor numeric,
               tipo text, produto_id bigint, cliente_id bigint, unidades integer,
               categoria text, created_at timestamptz, updated_at timestamptz)
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
             m.produto_id, m.cliente_id, m.unidades, m.categoria, m.created_at, m.updated_at
      FROM public.metas m
      ORDER BY m.mes DESC, m.linha, m.tipo;
END;
$$;

-- Cria/atualiza meta. Tipos:
--   'mensal'    -> valor R$ por mes/linha
--   'produto'   -> unidades do produto (_produto_id) no mes
--   'cliente'   -> valor R$ de vendas do cliente (_cliente_id) no mes
--   'categoria' -> valor R$ de vendas da categoria (_categoria) no mes
DROP FUNCTION IF EXISTS public.admin_salvar_meta(text, text, text, numeric, bigint, text, bigint, bigint, integer);
CREATE OR REPLACE FUNCTION public.admin_salvar_meta(
    _token text, _linha text, _mes text, _valor numeric, _id bigint DEFAULT NULL,
    _tipo text DEFAULT 'mensal', _produto_id bigint DEFAULT NULL,
    _cliente_id bigint DEFAULT NULL, _unidades integer DEFAULT NULL,
    _categoria text DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _ret bigint;
DECLARE _mesd date;
DECLARE _cat text;
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
    IF _tipo NOT IN ('mensal', 'produto', 'cliente', 'categoria') THEN
        RAISE EXCEPTION 'Tipo de meta invalido' USING ERRCODE = '22023';
    END IF;
    IF _tipo = 'produto' AND _produto_id IS NULL THEN
        RAISE EXCEPTION 'Selecione o produto' USING ERRCODE = '22023';
    END IF;
    IF _tipo = 'cliente' AND _cliente_id IS NULL THEN
        RAISE EXCEPTION 'Selecione o cliente' USING ERRCODE = '22023';
    END IF;
    _cat := nullif(trim(coalesce(_categoria, '')), '');
    IF _tipo = 'categoria' AND _cat IS NULL THEN
        RAISE EXCEPTION 'Selecione a categoria' USING ERRCODE = '22023';
    END IF;
    -- Limpa categoria para os tipos que nao a utilizam.
    IF _tipo <> 'categoria' THEN
        _cat := NULL;
    END IF;
    IF _id IS NULL THEN
        INSERT INTO public.metas (linha, mes, valor, tipo, produto_id, cliente_id, unidades, categoria)
        VALUES (_linha, _mesd, coalesce(_valor, 0), _tipo, _produto_id, _cliente_id, _unidades, _cat)
        ON CONFLICT (linha, mes, tipo, produto_id, cliente_id, categoria)
        DO UPDATE SET
            valor = excluded.valor,
            unidades = excluded.unidades,
            updated_at = now()
        RETURNING id INTO _ret;
    ELSE
        UPDATE public.metas
           SET linha = _linha, mes = _mesd, valor = coalesce(_valor, 0),
               tipo = _tipo, produto_id = _produto_id, cliente_id = _cliente_id,
               unidades = _unidades, categoria = _cat, updated_at = now()
         WHERE id = _id
         RETURNING id INTO _ret;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Meta nao encontrada' USING ERRCODE = 'P0002';
        END IF;
    END IF;
    RETURN _ret;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_listar_metas(text)                                  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_salvar_meta(text, text, text, numeric, bigint, text, bigint, bigint, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_excluir_meta(text, bigint)                          FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_listar_metas(text)                                  TO anon;
GRANT EXECUTE ON FUNCTION public.admin_salvar_meta(text, text, text, numeric, bigint, text, bigint, bigint, integer, text) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_excluir_meta(text, bigint)                          TO anon;
