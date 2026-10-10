-- ============================================================================
-- Addendum 11:
--  Limpeza em massa (bulk) dos marcadores DESTAQUE e PROMOCAO de TODOS os
--  produtos de uma vez, para facilitar a atualizacao da vitrine do site.
--  Retorna quantos produtos foram alterados.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_limpar_flags_produtos(_token text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _limpos integer;
BEGIN
    IF public.admin_requerido(_token) IS NULL THEN
        RAISE EXCEPTION 'Nao autorizado' USING ERRCODE = '42501';
    END IF;

    UPDATE public.produtos
       SET isdestaque = false,
           ispromocao = false,
           precopromocional = 0,
           updated_at = now()
     WHERE isdestaque OR ispromocao;

    GET DIAGNOSTICS _limpos = ROW_COUNT;
    RETURN _limpos;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_limpar_flags_produtos(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_limpar_flags_produtos(text) TO anon;