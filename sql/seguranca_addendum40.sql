-- Addendum 40: Permitir escolher qual cadastro usar quando houver e-mail duplicado
BEGIN;

-- Lista contas por identificador (email ou CNPJ)
CREATE OR REPLACE FUNCTION public.cliente_listar_por_identificador(_identificador text)
RETURNS TABLE (id bigint, razao_social text, email text, cnpj text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _digits text;
BEGIN
    _digits := regexp_replace(coalesce(_identificador, ''), '\D', '', 'g');
    RETURN QUERY
    SELECT c.id, c.razao_social, c.email, c.cnpj
    FROM public.clientes c
    WHERE lower(trim(c.email)) = lower(trim(coalesce(_identificador, '')))
       OR (_digits <> '' AND regexp_replace(coalesce(c.cnpj, ''), '\D', '', 'g') = _digits)
    ORDER BY c.id;
END;
$$;

REVOKE ALL ON FUNCTION public.cliente_listar_por_identificador(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cliente_listar_por_identificador(text) TO anon;

-- verificar_login com opção de escolher conta
DROP FUNCTION IF EXISTS public.verificar_login(text, text, text);
CREATE OR REPLACE FUNCTION public.verificar_login(_identificador text, _senha_email text, _senha_cnpj text, _cliente_id bigint DEFAULT NULL)
RETURNS TABLE (id bigint, razao_social text, email text, senha_trocada boolean, erro text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _row public.clientes%ROWTYPE;
DECLARE _digits text;
DECLARE _key text;
DECLARE _secs integer;
DECLARE _cands bigint[];
BEGIN
    _digits := regexp_replace(coalesce(_identificador, ''), '\D', '', 'g');
    _key := 'cli:' || encode(extensions.digest(public.real_client_ip() || '|' || lower(coalesce(_identificador, '')), 'sha256'), 'hex');
    _secs := public.tempo_bloqueio(_key);
    IF _secs > 0 THEN
        RETURN QUERY SELECT NULL::bigint, NULL::text, NULL::text, false, 'LOCK:' || ceil(_secs / 60.0)::text;
        RETURN;
    END IF;

    IF _cliente_id IS NOT NULL THEN
        SELECT * INTO _row FROM public.clientes WHERE id = _cliente_id;
        IF NOT FOUND THEN
            PERFORM public.registrar_falha(_key);
            RETURN QUERY SELECT NULL::bigint, NULL::text, NULL::text, false, 'NAOCAD';
            RETURN;
        END IF;
        IF regexp_replace(coalesce(_row.cnpj,''),'\D','','g') = _digits AND _digits <> '' THEN
            IF _row.senha IS DISTINCT FROM _senha_cnpj THEN
                PERFORM public.registrar_falha(_key);
                RETURN QUERY SELECT NULL::bigint, NULL::text, NULL::text, false, 'ERR:senha';
                RETURN;
            END IF;
        ELSIF lower(trim(_row.email)) = lower(trim(coalesce(_identificador,''))) THEN
            IF _row.senha IS DISTINCT FROM _senha_email THEN
                PERFORM public.registrar_falha(_key);
                RETURN QUERY SELECT NULL::bigint, NULL::text, NULL::text, false, 'ERR:senha';
                RETURN;
            END IF;
        ELSE
            PERFORM public.registrar_falha(_key);
            RETURN QUERY SELECT NULL::bigint, NULL::text, NULL::text, false, 'ERR:senha';
            RETURN;
        END IF;
        DELETE FROM public.login_attempts WHERE key = _key;
        RETURN QUERY SELECT _row.id, _row.razao_social, _row.email, coalesce(_row.senha_trocada, false), NULL::text;
        RETURN;
    END IF;

    SELECT array_agg(c.id ORDER BY c.id) INTO _cands
    FROM public.clientes c
    WHERE lower(trim(c.email)) = lower(trim(coalesce(_identificador, '')));

    IF _cands IS NOT NULL AND array_length(_cands,1) > 1 THEN
        RETURN QUERY
        SELECT c.id, c.razao_social, c.email, false, 'CHOOSE'::text
        FROM public.clientes c
        WHERE lower(trim(c.email)) = lower(trim(coalesce(_identificador, '')))
        ORDER BY c.id;
        RETURN;
    END IF;

    SELECT * INTO _row FROM public.clientes
     WHERE lower(trim(email)) = lower(trim(coalesce(_identificador, '')))
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
    RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.verificar_login(text,text,text,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verificar_login(text,text,text,bigint) TO anon;

COMMIT;
