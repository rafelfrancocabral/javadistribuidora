-- ============================================================================
-- Addendum 8: DATA DA VENDA = DATA EM QUE O PEDIDO FICOU 'concluido'
-- O dashboard passou a usar a data de conclusao (nao a de criacao) como
-- referencia da venda em todos os graficos. Orcamentos podem esperar semanas
-- ate serem aprovados; a venda conta no dia em que o status virou CONCLUIDO.
-- ============================================================================

ALTER TABLE public.orcamentos ADD COLUMN IF NOT EXISTS concluido_em TIMESTAMPTZ;

-- Backfill: vendas ja concluidas recebem a data da ultima alteracao de status
UPDATE public.orcamentos
   SET concluido_em = coalesce(updated_at, created_at)
 WHERE status = 'concluido' AND concluido_em IS NULL;

CREATE INDEX IF NOT EXISTS idx_orcamentos_concluido_em ON public.orcamentos (concluido_em);

-- Listagem: expoe concluido_em para o dashboard
-- (DROP necessario: RETURNS TABLE ganha a coluna concluido_em)
DROP FUNCTION IF EXISTS public.admin_listar_orcamentos(text);

CREATE OR REPLACE FUNCTION public.admin_listar_orcamentos(_token text)
RETURNS TABLE (id bigint, nome_cliente text, telefone text, email text,
               codigo_cliente text, codigo_retirada text, itens jsonb, total numeric,
               pagamento text, status text, status_entrega text, linha text,
               created_at timestamptz, updated_at timestamptz, concluido_em timestamptz)
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
             o.status_entrega, o.linha, o.created_at, o.updated_at, o.concluido_em
      FROM public.orcamentos o
      ORDER BY o.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_listar_orcamentos(text) TO anon;

-- Mudanca de status: carimba/limpa a data de conclusao
CREATE OR REPLACE FUNCTION public.admin_atualizar_status_orcamento(
    _token text, _id bigint, _status text, _status_entrega text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF public.admin_requerido(_token) IS NULL THEN
        RAISE EXCEPTION 'Nao autorizado' USING ERRCODE = '42501';
    END IF;
    UPDATE public.orcamentos
       SET status = _status,
           status_entrega = coalesce(_status_entrega, status_entrega),
           updated_at = now(),
           concluido_em = CASE
                            WHEN _status = 'concluido'
                                 THEN CASE WHEN orcamentos.status = 'concluido'
                                           THEN orcamentos.concluido_em
                                           ELSE now() END
                            ELSE NULL
                          END
     WHERE id = _id;
    RETURN TRUE;
END;
$$;