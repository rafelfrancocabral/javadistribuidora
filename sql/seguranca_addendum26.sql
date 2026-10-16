-- ============================================================================
-- Addendum 26: Correções
--  1) admin_listar_orcamentos: a coluna concluido_em NAO existe na tabela
--     orcamentos (o addendum8 nunca foi aplicado no banco). A recriacao feita
--     no addendum24 referenciava concluido_em e quebrava a listagem de
--     orcamentos no dashboard. Aqui recriamos a funcao com as colunas
--     originais + "obs" (sem concluido_em).
--  2) Seguranca: criar_sessao_admin nao deve ser executavel por anon
--     (qualquer um poderia criar uma sessao de admin).
-- ============================================================================

-- 1) Listagem de orcamentos (colunas originais + obs), sem concluido_em
DROP FUNCTION IF EXISTS public.admin_listar_orcamentos(text);
CREATE OR REPLACE FUNCTION public.admin_listar_orcamentos(_token text)
RETURNS TABLE (id bigint, nome_cliente text, telefone text, email text,
               codigo_cliente text, codigo_retirada text, itens jsonb, total numeric,
               pagamento text, status text, status_entrega text, linha text,
               created_at timestamptz, updated_at timestamptz, obs text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF public.admin_requerido(_token) IS NULL THEN
        RAISE EXCEPTION 'Nao autorizado' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
      SELECT o.id, o.nome_cliente, o.telefone, o.email, o.codigo_cliente,
             o.codigo_retirada, o.itens, o.total, o.pagamento, o.status,
             o.status_entrega, o.linha, o.created_at, o.updated_at, o.obs
      FROM public.orcamentos o
      ORDER BY o.created_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_listar_orcamentos(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_listar_orcamentos(text) TO anon;

-- 2) Fecha o buraco: apenas o admin (via login) pode criar sessao.
REVOKE ALL ON FUNCTION public.criar_sessao_admin(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.criar_sessao_admin(bigint) FROM anon;
