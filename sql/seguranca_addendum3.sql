-- Addendum 3: conserta geracao do token de sessao.
-- Motivo: no Supabase o pgcrypto fica no schema `extensions`; as funcoes
-- SECURITY DEFINER usam search_path = public, entao gen_random_bytes nao
-- resolve. Qualificamos com extensions.gen_random_bytes.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.criar_sessao_admin(_admin_id bigint)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _token text;
BEGIN
    DELETE FROM public.admin_sessions
     WHERE expires_at < now() OR admin_id = _admin_id;
    _token := encode(extensions.gen_random_bytes(24), 'hex');
    INSERT INTO public.admin_sessions (token, admin_id, expires_at)
    VALUES (_token, _admin_id, now() + interval '12 hours');
    RETURN _token;
END;
$$;