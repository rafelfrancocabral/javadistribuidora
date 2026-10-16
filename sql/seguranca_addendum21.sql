-- ============================================================================
-- Addendum 21: Prize, Rules, League
-- ============================================================================

-- Configurações do site (Prize, Rules)
CREATE TABLE IF NOT EXISTS public.site_config (
  chave text PRIMARY KEY,
  valor text,
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.site_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.site_config FROM anon;

-- Campos para League (pontos e resgates por cliente)
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS pontos numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS resgates integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_clientes_pontos ON public.clientes (pontos DESC);
CREATE INDEX IF NOT EXISTS idx_clientes_resgates ON public.clientes (resgates DESC);

-- Obter config (admin)
CREATE OR REPLACE FUNCTION public.admin_get_config(_token text, _chave text)
RETURNS TABLE(chave text, valor text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.admin_requerido(_token) IS NULL THEN
    RAISE EXCEPTION 'Nao autorizado' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT c.chave, c.valor
    FROM public.site_config c
    WHERE c.chave = _chave;
END;
$$;

-- Salvar config (admin)
CREATE OR REPLACE FUNCTION public.admin_set_config(_token text, _chave text, _valor text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.admin_requerido(_token) IS NULL THEN
    RAISE EXCEPTION 'Nao autorizado' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.site_config (chave, valor, updated_at)
  VALUES (_chave, _valor, now())
  ON CONFLICT (chave) DO UPDATE
    SET valor = EXCLUDED.valor,
        updated_at = now();
END;
$$;

-- Listar League (clientes com pontos/resgates)
CREATE OR REPLACE FUNCTION public.admin_listar_league(_token text, _limite integer DEFAULT 200)
RETURNS TABLE(
  id bigint,
  razao_social text,
  email text,
  telefone text,
  pontos numeric,
  resgates integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.admin_requerido(_token) IS NULL THEN
    RAISE EXCEPTION 'Nao autorizado' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT
      cl.id,
      cl.razao_social,
      cl.email,
      cl.telefone,
      cl.pontos,
      cl.resgates
    FROM public.clientes cl
    ORDER BY cl.pontos DESC, cl.resgates DESC, cl.razao_social ASC
    LIMIT GREATEST(1, LEAST(_limite, 1000));
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_config(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_set_config(text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_listar_league(text, integer) TO anon;

REVOKE ALL ON FUNCTION public.admin_get_config(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_config(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_listar_league(text, integer) FROM PUBLIC;
