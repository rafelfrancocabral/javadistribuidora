-- ============================================================================
-- Addendum 23: Regras de pontuação com nome, validade e conversor R$ -> pontos
-- ============================================================================

-- Campos extras para as regras (mesmos campos do prêmio)
ALTER TABLE public.regras_pontuacao ADD COLUMN IF NOT EXISTS nome text;
ALTER TABLE public.regras_pontuacao ADD COLUMN IF NOT EXISTS validade date;

-- Listar regras (agora com nome e validade)
DROP FUNCTION IF EXISTS public.admin_listar_regras_pontuacao(text);
CREATE OR REPLACE FUNCTION public.admin_listar_regras_pontuacao(_token text)
RETURNS TABLE(
  id bigint,
  nome text,
  valor_compra_min numeric,
  valor_compra_max numeric,
  pontos numeric,
  ativo boolean,
  validade date,
  created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.admin_requerido(_token) IS NULL THEN
    RAISE EXCEPTION 'Nao autorizado' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT r.id, r.nome, r.valor_compra_min, r.valor_compra_max, r.pontos, r.ativo, r.validade, r.created_at
    FROM public.regras_pontuacao r
    ORDER BY r.valor_compra_min ASC;
END; $$;

-- Salvar regra (agora com nome, validade e conversao R$ -> pontos)
DROP FUNCTION IF EXISTS public.admin_salvar_regra_pontuacao(text, bigint, numeric, numeric, numeric, boolean);
CREATE OR REPLACE FUNCTION public.admin_salvar_regra_pontuacao(
  _token text,
  _id bigint DEFAULT NULL,
  _nome text DEFAULT NULL,
  _valor_compra_min numeric DEFAULT NULL,
  _valor_compra_max numeric DEFAULT NULL,
  _pontos numeric DEFAULT NULL,
  _ativo boolean DEFAULT true,
  _validade date DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _ret bigint;
BEGIN
  IF public.admin_requerido(_token) IS NULL THEN
    RAISE EXCEPTION 'Nao autorizado' USING ERRCODE = '42501';
  END IF;
  IF _id IS NULL THEN
    INSERT INTO public.regras_pontuacao(nome, valor_compra_min, valor_compra_max, pontos, ativo, validade, created_at)
    VALUES (nullif(trim(coalesce(_nome,'')),''), _valor_compra_min, _valor_compra_max, _pontos, COALESCE(_ativo,true), _validade, now())
    RETURNING id INTO _ret;
  ELSE
    UPDATE public.regras_pontuacao
       SET nome = nullif(trim(coalesce(_nome,'')),''),
           valor_compra_min = _valor_compra_min,
           valor_compra_max = _valor_compra_max,
           pontos = _pontos,
           ativo = COALESCE(_ativo,true),
           validade = _validade
     WHERE id = _id
    RETURNING id INTO _ret;
  END IF;
  RETURN _ret;
END; $$;

GRANT EXECUTE ON FUNCTION public.admin_listar_regras_pontuacao(text) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_salvar_regra_pontuacao(text,bigint,text,numeric,numeric,numeric,boolean,date) TO anon;
REVOKE ALL ON FUNCTION public.admin_listar_regras_pontuacao(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_salvar_regra_pontuacao(text,bigint,text,numeric,numeric,numeric,boolean,date) FROM PUBLIC;
