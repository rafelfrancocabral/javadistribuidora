-- ============================================================================
-- Addendum 9: METAS (Playbook) - meta mensal de venda por linha (Java/Dymar)
-- Tabela 'metas': 1 meta por (linha, mes). Mes = primeiro dia do mes (date).
-- Acesso somente via funcoes SECURITY DEFINER com token de sessao do painel.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.metas (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    linha      text NOT NULL DEFAULT 'java' CHECK (linha IN ('java', 'dymar')),
    mes        date NOT NULL,
    valor      numeric(12,2) NOT NULL DEFAULT 0 CHECK (valor >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_metas_linha_mes ON public.metas (linha, mes);

ALTER TABLE public.metas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.metas FROM anon;

-- Lista todas as metas
CREATE OR REPLACE FUNCTION public.admin_listar_metas(_token text)
RETURNS TABLE (id bigint, linha text, mes date, valor numeric,
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
      SELECT m.id, m.linha, m.mes, m.valor, m.created_at, m.updated_at
      FROM public.metas m
      ORDER BY m.mes DESC, m.linha;
END;
$$;

-- Cria/atualiza uma meta. Passar _mes como 'YYYY-MM'. Se ja existir meta para a
-- mesma (linha, mes), o valor e substituido (nao cria duplicidade).
CREATE OR REPLACE FUNCTION public.admin_salvar_meta(
    _token text, _linha text, _mes text, _valor numeric, _id bigint DEFAULT NULL)
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
    IF _id IS NULL THEN
        INSERT INTO public.metas (linha, mes, valor)
        VALUES (_linha, _mesd, coalesce(_valor, 0))
        ON CONFLICT (linha, mes)
        DO UPDATE SET valor = excluded.valor, updated_at = now()
        RETURNING id INTO _ret;
    ELSE
        UPDATE public.metas
           SET linha = _linha, mes = _mesd, valor = coalesce(_valor, 0),
               updated_at = now()
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

REVOKE ALL ON FUNCTION public.admin_listar_metas(text)          FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_salvar_meta(text, text, text, numeric, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_excluir_meta(text, bigint)  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_listar_metas(text)          TO anon;
GRANT EXECUTE ON FUNCTION public.admin_salvar_meta(text, text, text, numeric, bigint) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_excluir_meta(text, bigint)  TO anon;