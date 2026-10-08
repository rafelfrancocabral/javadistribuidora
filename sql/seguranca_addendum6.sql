-- ============================================================================
-- Addendum 6: LIMITE DE TENTATIVAS FUNCIONAL (rollback-proof)
-- O problema do addendum5: login que falhava fazia RAISE -> PostgREST
-- fazia rollback -> o incremento do contador era desfeito -> nunca travava.
-- Agora as falhas NAO levantam excecao: retornam codigos (string/texto) e o
-- request termina em 200 -> o contador COMMITA e o bloqueio funciona.
-- Tambem corrige o verificar_login: RETURNS TABLE gera variavel "email" que
-- colidia com a coluna clientes.email (erro 42702) -> colunas qualificadas.
-- ============================================================================

-- ===== LOGIN DO PAINEL =====
-- Retorna: token (48 hex) em caso de sucesso, 'LOCK:N' (bloqueado por N min)
-- ou 'ERR:invalid' (credenciais invalidas). Nenhum RAISE nas falhas.
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

-- ===== LOGIN DO CLIENTE =====
-- Retorna 1 linha: sucesso -> id/razao/email/senha_trocada com erro NULL;
-- falha -> codigo em "erro": 'LOCK:<min>', 'SENHA' ou 'NAOCAD'.
DROP FUNCTION IF EXISTS public.verificar_login(text, text, text);

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
        RETURN QUERY SELECT 0::bigint, ''::text, ''::text, false, 'LOCK:' || ceil(_secs / 60.0)::text;
        RETURN;
    END IF;

    SELECT * INTO _row FROM public.clientes
     WHERE lower(clientes.email) = lower(coalesce(_identificador, ''))
     ORDER BY clientes.id LIMIT 1;

    IF NOT FOUND AND _digits <> '' THEN
        SELECT * INTO _row FROM public.clientes
         WHERE regexp_replace(coalesce(clientes.cnpj, ''), '\D', '', 'g') = _digits
         ORDER BY clientes.id LIMIT 1;
        IF FOUND THEN
            IF _row.senha IS DISTINCT FROM _senha_cnpj THEN
                PERFORM public.registrar_falha(_key);
                RETURN QUERY SELECT 0::bigint, ''::text, ''::text, false, 'SENHA';
                RETURN;
            END IF;
            DELETE FROM public.login_attempts WHERE key = _key;
            RETURN QUERY SELECT _row.id, _row.razao_social, _row.email, coalesce(_row.senha_trocada, false), NULL::text;
            RETURN;
        END IF;
    END IF;

    IF NOT FOUND THEN
        PERFORM public.registrar_falha(_key);
        RETURN QUERY SELECT 0::bigint, ''::text, ''::text, false, 'NAOCAD';
        RETURN;
    END IF;
    IF _row.senha IS DISTINCT FROM _senha_email THEN
        PERFORM public.registrar_falha(_key);
        RETURN QUERY SELECT 0::bigint, ''::text, ''::text, false, 'SENHA';
        RETURN;
    END IF;
    DELETE FROM public.login_attempts WHERE key = _key;
    RETURN QUERY SELECT _row.id, _row.razao_social, _row.email, coalesce(_row.senha_trocada, false), NULL::text;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_autenticar(text, text)      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verificar_login(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_autenticar(text, text)      TO anon;
GRANT EXECUTE ON FUNCTION public.verificar_login(text, text, text) TO anon;