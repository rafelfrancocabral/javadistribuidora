-- ============================================================================
-- Addendum 22: Prêmios, Regras de Pontuação, League filtrada
-- ============================================================================

-- Tabela de prêmios
CREATE TABLE IF NOT EXISTS public.premios (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nome text NOT NULL,
  pontos_necessarios numeric(10,2) NOT NULL DEFAULT 0,
  quantidade integer,
  ativo boolean NOT NULL DEFAULT true,
  validade date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.premios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.premios FROM anon;

-- Tabela de regras de pontuação (R$ -> pontos)
CREATE TABLE IF NOT EXISTS public.regras_pontuacao (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  valor_compra_min numeric(12,2) NOT NULL,
  valor_compra_max numeric(12,2),
  pontos numeric(10,2) NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.regras_pontuacao ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.regras_pontuacao FROM anon;

-- Identificar se cliente já comprou pelo site (tem pelo menos pedido concluído ou orçamento concluído?)
-- Vamos considerar: clientes que aparecem em pedidos/orçamentos concluídos com email válido
-- Adicionar flag opcional
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS ja_comprou_site boolean DEFAULT false;
UPDATE public.clientes SET ja_comprou_site = true
WHERE email IS NOT NULL AND email != ''
  AND EXISTS (
    SELECT 1 FROM public.orcamentos o
    WHERE lower(trim(o.email)) = lower(trim(clientes.email))
      AND o.status IN ('recebido', 'concluido')
  );

-- RPCs
CREATE OR REPLACE FUNCTION public.admin_listar_premios(_token text)
RETURNS TABLE(id bigint, nome text, pontos_necessarios numeric, quantidade integer, ativo boolean, validade date, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.admin_requerido(_token) IS NULL THEN RAISE EXCEPTION 'Nao autorizado' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT pr.id, pr.nome, pr.pontos_necessarios, pr.quantidade, pr.ativo, pr.validade, pr.created_at FROM public.premios pr ORDER BY pr.ativo DESC, pr.pontos_necessarios ASC, pr.nome ASC;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_salvar_premio(_token text, _id bigint DEFAULT NULL, _nome text DEFAULT NULL, _pontos_necessarios numeric DEFAULT NULL, _quantidade integer DEFAULT NULL, _ativo boolean DEFAULT true, _validade date DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _ret bigint;
BEGIN
  IF public.admin_requerido(_token) IS NULL THEN RAISE EXCEPTION 'Nao autorizado' USING ERRCODE='42501'; END IF;
  IF _id IS NULL THEN
    INSERT INTO public.premios(nome, pontos_necessarios, quantidade, ativo, validade, updated_at)
    VALUES (_nome, _pontos_necessarios, _quantidade, COALESCE(_ativo,true), _validade, now())
    RETURNING id INTO _ret;
  ELSE
    UPDATE public.premios SET nome=_nome, pontos_necessarios=_pontos_necessarios, quantidade=_quantidade, ativo=_ativo, validade=_validade, updated_at=now() WHERE id=_id RETURNING id INTO _ret;
  END IF;
  RETURN _ret;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_remover_premio(_token text, _id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.admin_requerido(_token) IS NULL THEN RAISE EXCEPTION 'Nao autorizado' USING ERRCODE='42501'; END IF;
  DELETE FROM public.premios WHERE id=_id;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_listar_regras_pontuacao(_token text)
RETURNS TABLE(id bigint, valor_compra_min numeric, valor_compra_max numeric, pontos numeric, ativo boolean, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.admin_requerido(_token) IS NULL THEN RAISE EXCEPTION 'Nao autorizado' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT r.id, r.valor_compra_min, r.valor_compra_max, r.pontos, r.ativo, r.created_at FROM public.regras_pontuacao r ORDER BY r.valor_compra_min ASC;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_salvar_regra_pontuacao(_token text, _id bigint DEFAULT NULL, _valor_compra_min numeric DEFAULT NULL, _valor_compra_max numeric DEFAULT NULL, _pontos numeric DEFAULT NULL, _ativo boolean DEFAULT true)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _ret bigint;
BEGIN
  IF public.admin_requerido(_token) IS NULL THEN RAISE EXCEPTION 'Nao autorizado' USING ERRCODE='42501'; END IF;
  IF _id IS NULL THEN
    INSERT INTO public.regras_pontuacao(valor_compra_min, valor_compra_max, pontos, ativo) VALUES (_valor_compra_min, _valor_compra_max, _pontos, COALESCE(_ativo,true)) RETURNING id INTO _ret;
  ELSE
    UPDATE public.regras_pontuacao SET valor_compra_min=_valor_compra_min, valor_compra_max=_valor_compra_max, pontos=_pontos, ativo=_ativo WHERE id=_id RETURNING id INTO _ret;
  END IF;
  RETURN _ret;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_remover_regra_pontuacao(_token text, _id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.admin_requerido(_token) IS NULL THEN RAISE EXCEPTION 'Nao autorizado' USING ERRCODE='42501'; END IF;
  DELETE FROM public.regras_pontuacao WHERE id=_id;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_listar_league_filtrada(_token text, _limite int DEFAULT 500)
RETURNS TABLE(id bigint, razao_social text, email text, telefone text, pontos numeric, resgates int, ja_comprou_site boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.admin_requerido(_token) IS NULL THEN RAISE EXCEPTION 'Nao autorizado' USING ERRCODE='42501'; END IF;
  RETURN QUERY
    SELECT cl.id, cl.razao_social, cl.email, cl.telefone, cl.pontos, cl.resgates, COALESCE(cl.ja_comprou_site, false)
    FROM public.clientes cl
    WHERE COALESCE(cl.ja_comprou_site, false) = true
    ORDER BY cl.pontos DESC, cl.resgates ASC, cl.razao_social ASC
    LIMIT GREATEST(1, LEAST(_limite,1000));
END; $$;

GRANT EXECUTE ON FUNCTION public.admin_listar_premios(text) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_salvar_premio(text,bigint,text,numeric,int,boolean,date) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_remover_premio(text,bigint) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_listar_regras_pontuacao(text) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_salvar_regra_pontuacao(text,bigint,numeric,numeric,numeric,boolean) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_remover_regra_pontuacao(text,bigint) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_listar_league_filtrada(text,int) TO anon;

REVOKE ALL ON FUNCTION public.admin_listar_premios(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_salvar_premio(text,bigint,text,numeric,int,boolean,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_remover_premio(text,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_listar_regras_pontuacao(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_salvar_regra_pontuacao(text,bigint,numeric,numeric,numeric,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_remover_regra_pontuacao(text,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_listar_league_filtrada(text,int) FROM PUBLIC;
