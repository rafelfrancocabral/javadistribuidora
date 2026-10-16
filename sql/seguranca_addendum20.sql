-- ============================================================================
-- Addendum 20:
--   Tracking de eventos do site (carrinho) e log de buscas.
-- ============================================================================
-- Tabela de eventos do site
CREATE TABLE IF NOT EXISTS public.site_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tipo text NOT NULL CHECK (tipo IN ('cart_add','cart_remove','cart_empty','cart_checkout_open','order_finalized','order_abandoned','search')),
  produto_id bigint,
  codigo text,
  nome text,
  carrinho_qtd integer,
  total numeric(12,2),
  email text,
  ip text,
  user_agent text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.site_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.site_events FROM anon;
CREATE INDEX IF NOT EXISTS idx_site_events_tipo_created ON public.site_events (tipo, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_site_events_created ON public.site_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_site_events_email ON public.site_events (email);

-- Log de buscas do site
CREATE TABLE IF NOT EXISTS public.site_searches (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  termo text NOT NULL,
  resultados integer,
  email text,
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.site_searches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.site_searches FROM anon;
CREATE INDEX IF NOT EXISTS idx_site_searches_termo ON public.site_searches (termo);
CREATE INDEX IF NOT EXISTS idx_site_searches_created ON public.site_searches (created_at DESC);

-- Registrar evento (público - site)
CREATE OR REPLACE FUNCTION public.registrar_site_event(
  _tipo text,
  _produto_id bigint DEFAULT NULL,
  _codigo text DEFAULT NULL,
  _nome text DEFAULT NULL,
  _carrinho_qtd integer DEFAULT NULL,
  _total numeric DEFAULT NULL,
  _email text DEFAULT NULL,
  _metadata jsonb DEFAULT NULL,
  _user_agent text DEFAULT NULL,
  _ip text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _ret bigint;
BEGIN
  _tipo := lower(trim(coalesce(_tipo,'')));
  IF _tipo NOT IN ('cart_add','cart_remove','cart_empty','cart_checkout_open','order_finalized','order_abandoned','search') THEN
    RAISE EXCEPTION 'Tipo de evento invalido' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.site_events (tipo, produto_id, codigo, nome, carrinho_qtd, total, email, metadata, user_agent, ip)
  VALUES (_tipo, _produto_id, nullif(trim(_codigo),''), nullif(trim(_nome),''), _carrinho_qtd, _total, lower(nullif(trim(_email),'')), _metadata, _user_agent, _ip)
  RETURNING id INTO _ret;
  RETURN _ret;
END;
$$;

-- Registrar busca (público)
CREATE OR REPLACE FUNCTION public.registrar_site_search(
  _termo text,
  _resultados integer DEFAULT NULL,
  _email text DEFAULT NULL,
  _user_agent text DEFAULT NULL,
  _ip text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _ret bigint;
BEGIN
  _termo := trim(coalesce(_termo,''));
  IF _termo = '' THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.site_searches (termo, resultados, email, user_agent, ip)
  VALUES (left(_termo,200), _resultados, lower(nullif(trim(_email),'')), _user_agent, _ip)
  RETURNING id INTO _ret;
  RETURN _ret;
END;
$$;

-- Listar eventos (admin)
CREATE OR REPLACE FUNCTION public.admin_listar_site_events(_token text, _limite integer DEFAULT 500)
RETURNS TABLE (
  id bigint, tipo text, produto_id bigint, codigo text, nome text, carrinho_qtd integer, total numeric, email text, metadata jsonb, created_at timestamptz
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
    SELECT e.id, e.tipo, e.produto_id, e.codigo, e.nome, e.carrinho_qtd, e.total, e.email, e.metadata, e.created_at
    FROM public.site_events e
    ORDER BY e.created_at DESC
    LIMIT GREATEST(1, LEAST(_limite, 2000));
END;
$$;

-- Listar buscas (admin)
CREATE OR REPLACE FUNCTION public.admin_listar_site_searches(_token text, _limite integer DEFAULT 500)
RETURNS TABLE (
  id bigint, termo text, resultados integer, email text, created_at timestamptz
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
    SELECT s.id, s.termo, s.resultados, s.email, s.created_at
    FROM public.site_searches s
    ORDER BY s.created_at DESC
    LIMIT GREATEST(1, LEAST(_limite, 2000));
END;
$$;

GRANT EXECUTE ON FUNCTION public.registrar_site_event(text,bigint,text,text,integer,numeric,text,jsonb,text,text) TO anon;
GRANT EXECUTE ON FUNCTION public.registrar_site_search(text,integer,text,text,text) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_listar_site_events(text,integer) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_listar_site_searches(text,integer) TO anon;
REVOKE ALL ON FUNCTION public.registrar_site_event(text,bigint,text,text,integer,numeric,text,jsonb,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.registrar_site_search(text,integer,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_listar_site_events(text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_listar_site_searches(text,integer) FROM PUBLIC;
