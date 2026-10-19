-- ============================================================================
-- Addendum 33: garantir funcoes de login (rate limit + autenticacao)
-- ============================================================================
-- Re-aplica o addendum 5 (idempotente) para garantir que as funcoes
-- real_client_ip, tempo_bloqueio, registrar_falha, admin_autenticar e
-- verificar_login existam, mesmo que o addendum 5 nao tenha sido rodado.
-- Necessario para o login do painel e do cliente exibirem mensagens de erro
-- e o limite de tentativas.
-- ============================================================================

-- Tabela de tentativas
CREATE TABLE IF NOT EXISTS public.login_attempts (
    key          text PRIMARY KEY,
    fails        integer NOT NULL DEFAULT 0,
    last_attempt timestamptz,
    locked_until timestamptz
);
CREATE INDEX IF NOT EXISTS login_attempts_locked_idx ON public.login_attempts(locked_until);
ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.login_attempts FROM PUBLIC;
REVOKE ALL ON public.login_attempts FROM anon, authenticated;

-- IP real do visitante
CREATE OR REPLACE FUNCTION public.real_client_ip()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE h text;
BEGIN
    BEGIN
        h := current_setting('request.headers', true);
    EXCEPTION WHEN OTHERS THEN
        h := NULL;
    END;
    IF h IS NULL OR h = '' THEN RETURN 'local'; END IF;
    RETURN coalesce(
        nullif((h::json ->> 'cf-connecting-ip')::text, ''),
        nullif((h::json ->> 'x-real-ip')::text, ''),
        nullif((h::json ->> 'x-forwarded-for')::text, ''),
        'local'
    );
END;
$$;

-- Segundos restantes de bloqueio (0 = liberado).
CREATE OR REPLACE FUNCTION public.tempo_bloqueio(_key text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE s integer;
BEGIN
    SELECT GREATEST(0, ceil(EXTRACT(EPOCH FROM (locked_until - now())))::integer)
      INTO s FROM public.login_attempts WHERE key = _key;
    RETURN coalesce(s, 0);
END;
$$;

-- Registrar falha (incrementa contador, aplica bloqueio exponencial).
CREATE OR REPLACE FUNCTION public.registrar_falha(_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _fails integer;
    _lock  integer;
BEGIN
    INSERT INTO public.login_attempts (key, fails, last_attempt, locked_until)
    VALUES (_key, 1, now(), NULL)
    ON CONFLICT (key) DO UPDATE
      SET fails = public.login_attempts.fails + 1,
          last_attempt = now();

    SELECT fails INTO _fails FROM public.login_attempts WHERE key = _key;
    IF _fails >= 5 THEN
        _lock := LEAST(3600, 300 * (1 << LEAST(_fails - 5, 4)));
        UPDATE public.login_attempts
           SET locked_until = now() + (_lock || ' seconds')::interval
         WHERE key = _key;
    END IF;
END;
$$;

-- Login do painel
CREATE OR REPLACE FUNCTION public.admin_autenticar(_usuario text, _senha_hash text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _row public.admins%ROWTYPE;
DECLARE _key text;
DECLARE _secs integer;
BEGIN
    _key := 'adm:' || encode(extensions.digest(public.real_client_ip() || '|' || lower(coalesce(_usuario, '')), 'sha256'), 'hex');
    _secs := public.tempo_bloqueio(_key);
    IF _secs > 0 THEN
        RETURN 'LOCK:' || ceil(_secs / 60.0)::text;
    END IF;
    SELECT * INTO _row FROM public.admins WHERE admins.usuario = _usuario;
    IF NOT FOUND OR _row.senha_hash IS DISTINCT FROM _senha_hash THEN
        PERFORM public.registrar_falha(_key);
        PERFORM pg_sleep(1);
        RETURN 'ERR:invalid';
    END IF;
    DELETE FROM public.login_attempts WHERE key = _key;
    RETURN public.criar_sessao_admin(_row.id);
END;
$$;

-- Login do cliente
CREATE OR REPLACE FUNCTION public.verificar_login(_identificador text, _senha_email text, _senha_cnpj text)
RETURNS TABLE (id bigint, razao_social text, email text, senha_trocada boolean, erro text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _row public.clientes%ROWTYPE;
DECLARE _digits text;
DECLARE _key text;
DECLARE _secs integer;
BEGIN
    _digits := regexp_replace(coalesce(_identificador, ''), '\D', '', 'g');
    _key := 'cli:' || encode(extensions.digest(public.real_client_ip() || '|' || lower(coalesce(_identificador, '')), 'sha256'), 'hex');
    _secs := public.tempo_bloqueio(_key);
    IF _secs > 0 THEN
        RETURN QUERY SELECT NULL::bigint, NULL::text, NULL::text, false, 'LOCK:' || ceil(_secs / 60.0)::text;
        RETURN;
    END IF;

    SELECT * INTO _row FROM public.clientes
     WHERE lower(email) = lower(coalesce(_identificador, ''))
     ORDER BY id LIMIT 1;

    IF NOT FOUND AND _digits <> '' THEN
        SELECT * INTO _row FROM public.clientes
         WHERE regexp_replace(coalesce(cnpj, ''), '\D', '', 'g') = _digits
         ORDER BY id LIMIT 1;
        IF FOUND THEN
            IF _row.senha IS DISTINCT FROM _senha_cnpj THEN
                PERFORM public.registrar_falha(_key);
                RETURN QUERY SELECT NULL::bigint, NULL::text, NULL::text, false, 'ERR:senha';
                RETURN;
            END IF;
            DELETE FROM public.login_attempts WHERE key = _key;
            RETURN QUERY SELECT _row.id, _row.razao_social, _row.email, coalesce(_row.senha_trocada, false), NULL::text;
            RETURN;
        END IF;
    END IF;

    IF NOT FOUND THEN
        PERFORM public.registrar_falha(_key);
        RETURN QUERY SELECT NULL::bigint, NULL::text, NULL::text, false, 'NAOCAD';
        RETURN;
    END IF;
    IF _row.senha IS DISTINCT FROM _senha_email THEN
        PERFORM public.registrar_falha(_key);
        RETURN QUERY SELECT NULL::bigint, NULL::text, NULL::text, false, 'ERR:senha';
        RETURN;
    END IF;
    DELETE FROM public.login_attempts WHERE key = _key;
    RETURN QUERY SELECT _row.id, _row.razao_social, _row.email, coalesce(_row.senha_trocada, false), NULL::text;
END;
$$;

-- Grants
REVOKE ALL ON FUNCTION public.real_client_ip, public.tempo_bloqueio, public.registrar_falha FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_autenticar(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.verificar_login(text, text, text) TO anon;
