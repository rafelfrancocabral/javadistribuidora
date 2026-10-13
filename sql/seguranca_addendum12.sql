-- ============================================================================
-- Addendum 12:
--  Acessos ao site (visitas). Permite ao painel exibir quantos acessos
--  o catalogo recebeu em cada periodo (hoje, 7 dias, mes, etc.).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.acessos (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pagina     text,
    origem     text,
    visitante  text,
    criado_em  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_acessos_criado ON public.acessos (criado_em DESC);

ALTER TABLE public.acessos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.acessos FROM anon;

-- Registra um acesso. Chamado pelo site (sem login). Deduplica o mesmo
-- visitante num intervalo curto para evitar duplicidade por refresh.
CREATE OR REPLACE FUNCTION public.registrar_acesso(
    _pagina text DEFAULT NULL,
    _origem text DEFAULT NULL,
    _visitante text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _v text;
BEGIN
    _v := left(coalesce(_visitante, ''), 64);
    IF _v <> '' AND EXISTS (
        SELECT 1 FROM public.acessos
        WHERE visitante = _v AND criado_em > now() - interval '5 seconds'
    ) THEN
        RETURN;
    END IF;
    INSERT INTO public.acessos (pagina, origem, visitante)
    VALUES (left(coalesce(_pagina, ''), 200), left(coalesce(_origem, ''), 300), _v);
END;
$$;

-- Conta os acessos desde uma data (admin).
CREATE OR REPLACE FUNCTION public.admin_contar_acessos(_token text, _desde timestamptz)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _total bigint;
BEGIN
    IF public.admin_requerido(_token) IS NULL THEN
        RAISE EXCEPTION 'Nao autorizado' USING ERRCODE = '42501';
    END IF;
    SELECT count(*) INTO _total
      FROM public.acessos
     WHERE _desde IS NULL OR criado_em >= _desde;
    RETURN _total;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_acesso(text, text, text)   FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_contar_acessos(text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_acesso(text, text, text)   TO anon;
GRANT EXECUTE ON FUNCTION public.admin_contar_acessos(text, timestamptz) TO anon;