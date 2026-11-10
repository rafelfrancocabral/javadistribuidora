-- ============================================================================
-- Addendum 44: TROCA DE SENHA APENAS UMA VEZ (primeiro acesso)
-- ----------------------------------------------------------------------------
-- Regras:
--  * Cliente novo com senha padrao (CNPJ) -> senha_trocada = false
--    (o sistema obriga a troca no primeiro login)
--  * Cliente novo com senha definida pelo admin -> senha_trocada = true
--    (nao forca troca)
--  * Depois que senha_trocada vira true, ela NUNCA volta para false por esta
--    funcao (OR logico): a troca obrigatoria acontece somente uma vez.
--  * Se o cliente quiser trocar novamente, usa a opcao manual do site.
--  * Corrige cadastros antigos que ficaram com o CNPJ em texto puro (sem hash),
--    que nao conseguiam autenticar.
-- ============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_salvar_cliente(_token text, _cliente jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _id bigint;
DECLARE _senha_hash text;
DECLARE _digits text;
DECLARE _nova boolean := coalesce((_cliente->>'novo')::boolean, false);
BEGIN
    IF public.admin_requerido(_token) IS NULL THEN
        RAISE EXCEPTION 'Nao autorizado' USING ERRCODE = '42501';
    END IF;
    _id := (_cliente->>'id')::bigint;

    IF _nova THEN
        _senha_hash := nullif(_cliente->>'senha', '');
        IF _senha_hash IS NULL THEN
            _digits := regexp_replace(coalesce(_cliente->>'cnpj', ''), '\D', '', 'g');
            IF _digits = '' THEN
                RAISE EXCEPTION 'Informe uma senha ou preencha o CNPJ' USING ERRCODE = '22023';
            END IF;
            _senha_hash := encode(extensions.digest(_digits, 'sha256'), 'hex');
        END IF;
        INSERT INTO public.clientes (razao_social, cnpj, email, telefone, senha,
                                     senha_trocada, created_at, updated_at)
        VALUES (coalesce(_cliente->>'razao_social', ''), _cliente->>'cnpj', lower(_cliente->>'email'),
                _cliente->>'telefone', _senha_hash,
                coalesce((_cliente->>'senha_trocada')::boolean, false), now(), now())
        RETURNING id INTO _id;
    ELSE
        IF _id IS NULL THEN
            RAISE EXCEPTION 'Cliente sem id para edicao' USING ERRCODE = '22023';
        END IF;
        _senha_hash := nullif(_cliente->>'senha', '');
        IF _senha_hash IS NOT NULL THEN
            UPDATE public.clientes
               SET razao_social = coalesce(_cliente->>'razao_social', razao_social),
                   cnpj = _cliente->>'cnpj',
                   email = lower(_cliente->>'email'),
                   telefone = _cliente->>'telefone',
                   senha = _senha_hash,
                   -- OR garante que uma senha ja trocada nunca volte a ser "padrao"
                   senha_trocada = coalesce(senha_trocada, false) OR coalesce((_cliente->>'senha_trocada')::boolean, false),
                   updated_at = now()
             WHERE id = _id;
        ELSE
            UPDATE public.clientes
               SET razao_social = coalesce(_cliente->>'razao_social', razao_social),
                   cnpj = _cliente->>'cnpj',
                   email = lower(_cliente->>'email'),
                   telefone = _cliente->>'telefone',
                   senha_trocada = coalesce(senha_trocada, false) OR coalesce((_cliente->>'senha_trocada')::boolean, false),
                   updated_at = now()
             WHERE id = _id;
        END IF;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Cliente nao encontrado' USING ERRCODE = 'P0002';
        END IF;
    END IF;
    RETURN _id;
END;
$$;

-- Corrige cadastros antigos gravados com o CNPJ puro em vez do hash SHA-256.
-- Mantem senha_trocada como esta (se false, continua exigindo a troca no 1o login).
UPDATE public.clientes
   SET senha = encode(extensions.digest(regexp_replace(coalesce(cnpj, ''), '\D', '', 'g'), 'sha256'), 'hex'),
       updated_at = now()
 WHERE coalesce(cnpj, '') <> ''
   AND length(regexp_replace(coalesce(cnpj, ''), '\D', '', 'g')) > 0
   AND senha = regexp_replace(coalesce(cnpj, ''), '\D', '', 'g');

-- Garante a permissao de execucao pela chave anon (o token de admin e validado
-- dentro da funcao).
GRANT EXECUTE ON FUNCTION public.admin_salvar_cliente(text, jsonb) TO anon;

-- Forca o PostgREST a atualizar o cache.
NOTIFY pgrst, 'reload schema';

COMMIT;
