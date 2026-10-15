-- ============================================================================
-- Addendum 15: listar os ultimos pedidos de um cliente (area do lojista)
--   Retorna os orcamentos do email informado, exceto rascunhos "em_andamento".
--   Usado pelo site para a opcao "Meus pedidos" no menu superior.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.listar_pedidos_cliente(_email text, _limite int DEFAULT 20)
RETURNS TABLE (
    id             bigint,
    codigo_cliente text,
    codigo_retirada text,
    status         text,
    status_entrega text,
    pagamento      text,
    total          numeric,
    itens          jsonb,
    created_at     timestamptz,
    updated_at     timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT o.id, o.codigo_cliente, o.codigo_retirada, o.status, o.status_entrega,
           o.pagamento, o.total, o.itens, o.created_at, o.updated_at
      FROM public.orcamentos o
     WHERE lower(trim(o.email)) = lower(trim(coalesce(_email, '')))
       AND coalesce(trim(_email), '') <> ''
       AND o.status <> 'em_andamento'
     ORDER BY o.created_at DESC
     LIMIT greatest(1, least(coalesce(_limite, 20), 50));
$$;

REVOKE ALL ON FUNCTION public.listar_pedidos_cliente(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listar_pedidos_cliente(text, int) TO anon;
