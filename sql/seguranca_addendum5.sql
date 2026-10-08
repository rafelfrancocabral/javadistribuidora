-- ============================================================================
-- Addendum 5: LIMITE DE TENTATIVAS DE LOGIN (forca bruta)
-- Aplica para o painel (admin_autenticar) e para o cliente (verificar_login).
-- Regra: 5 falhas consecutivas bloqueiam 5 min; o bloqueio cresce
-- exponencialmente (10, 20, 40...) ate o teto de 60 min. Login com sucesso
-- zera o contador. A chave e calculada por IP + identificador/email/cnpj.
-- ============================================================================

-- Tabela de tentativas (anon/authenticated nao acessam; so via funcoes)
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

-- IP real do visitante (headers que o PostgREST/Supabase expoe).
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

-- Registra falha e aplica bloqueio progressivo (teto 60 min).
CREATE OR REPLACE FUNCTION public.registrar_falha(_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    DELETE FROM public.login_attempts WHERE last_attempt < now() - interval '1 day';
    INSERT INTO public.login_attempts (key, fails, last_attempt)
    VALUES (_key, 1, now())
    ON CONFLICT (key) DO UPDATE SET
        fails = CASE WHEN login_attempts.locked_until IS NOT NULL
                      AND login_attempts.locked_until > now()
                     THEN login_attempts.fails
                     ELSE login_attempts.fails + 1 END,
        last_attempt = now(),
        locked_until = CASE WHEN login_attempts.locked_until IS NOT NULL
                             AND login_attempts.locked_until > now()
                            THEN login_attempts.locked_until ELSE NULL END;
    UPDATE public.login_attempts
       SET locked_until = now() + LEAST(interval '60 minutes',
                             (pow(2, GREATEST(login_attempts.fails - 5, 0)) * interval '5 minutes'))
     WHERE key = _key AND login_attempts.fails >= 5
       AND (locked_until IS NULL OR locked_until <= now());
END;
$$;

-- ===== LOGIN DO PAINEL com limite de tentativas =====
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
        RAISE EXCEPTION 'Muitas tentativas. Tente novamente em % minuto(s).', ceil(_secs / 60.0)::integer USING ERRCODE = '28P01';
    END IF;
    SELECT * INTO _row FROM public.admins WHERE usuario = _usuario;
    IF NOT FOUND OR _row.senha_hash IS DISTINCT FROM _senha_hash THEN
        PERFORM public.registrar_falha(_key);
        PERFORM pg_sleep(1);
        RAISE EXCEPTION 'Usuário ou senha inválidos' USING ERRCODE = '28P01';
    END IF;
    DELETE FROM public.login_attempts WHERE key = _key;
    RETURN public.criar_sessao_admin(_row.id);
END;
$$;

-- ===== LOGIN DO CLIENTE com limite de tentativas =====
CREATE OR REPLACE FUNCTION public.verificar_login(_identificador text, _senha_email text, _senha_cnpj text)
RETURNS TABLE (id bigint, razao_social text, email text, senha_trocada boolean)
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
        RAISE EXCEPTION 'Muitas tentativas. Tente novamente em % minuto(s).', ceil(_secs / 60.0)::integer USING ERRCODE = '28P01';
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
                RAISE EXCEPTION 'Senha incorreta' USING ERRCODE = '28P01';
            END IF;
            DELETE FROM public.login_attempts WHERE key = _key;
            RETURN QUERY SELECT _row.id, _row.razao_social, _row.email, coalesce(_row.senha_trocada, false);
            RETURN;
        END IF;
    END IF;

    IF NOT FOUND THEN
        PERFORM public.registrar_falha(_key);
        RAISE EXCEPTION 'Cliente nao cadastrado. Contate a loja.' USING ERRCODE = '28P01';
    END IF;
    IF _row.senha IS DISTINCT FROM _senha_email THEN
        PERFORM public.registrar_falha(_key);
        RAISE EXCEPTION 'Senha incorreta' USING ERRCODE = '28P01';
    END IF;
    DELETE FROM public.login_attempts WHERE key = _key;
    RETURN QUERY SELECT _row.id, _row.razao_social, _row.email, coalesce(_row.senha_trocada, false);
END;
$$;

-- helper nao fica acessivel ao publico
REVOKE ALL ON FUNCTION public.real_client_ip, public.tempo_bloqueio, public.registrar_falha FROM PUBLIC;
-- garante que os logins continuam chamaveis pelo anon (mantem grants ja existentes)
GRANT EXECUTE ON FUNCTION public.admin_autenticar(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.verificar_login(text, text, text) TO anon;