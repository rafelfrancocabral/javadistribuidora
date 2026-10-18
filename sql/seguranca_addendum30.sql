-- ============================================================================
-- Addendum 30: garantir coluna concluido_em + origem na listagem
-- ============================================================================
-- Corrige o erro "column o.concluido_em does not exist" que quebrava
-- admin_listar_orcamentos (e, por consequencia, a lista de orcamentos do
-- dashboard) quando o addendum 8 nao havia sido aplicado.
-- ============================================================================

-- 1) Coluna concluido_em (idempotente)
ALTER TABLE public.orcamentos ADD COLUMN IF NOT EXISTS concluido_em TIMESTAMPTZ;
UPDATE public.orcamentos
   SET concluido_em = coalesce(updated_at, created_at)
 WHERE status = 'concluido' AND concluido_em IS NULL;

CREATE INDEX IF NOT EXISTS idx_orcamentos_concluido_em ON public.orcamentos (concluido_em);

-- 2) Garantir coluna origem (idempotente)
ALTER TABLE public.orcamentos ADD COLUMN IF NOT EXISTS origem text DEFAULT 'manual';
UPDATE public.orcamentos
   SET origem = 'site'
 WHERE status_entrega IS NOT NULL AND trim(status_entrega) <> ''
   AND (origem IS NULL OR trim(origem) = '');
UPDATE public.orcamentos
   SET origem = 'manual'
 WHERE (origem IS NULL OR trim(origem) = '');

-- 3) admin_listar_orcamentos com origem + concluido_em
DROP FUNCTION IF EXISTS public.admin_listar_orcamentos(text);
CREATE OR REPLACE FUNCTION public.admin_listar_orcamentos(_token text)
RETURNS TABLE (id bigint, nome_cliente text, telefone text, email text,
               codigo_cliente text, codigo_retirada text, itens jsonb, total numeric,
               pagamento text, status text, status_entrega text, linha text,
               origem text, created_at timestamptz, updated_at timestamptz,
               concluido_em timestamptz, obs text)
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
             o.status_entrega, o.linha, o.origem, o.created_at, o.updated_at,
             o.concluido_em, o.obs
        FROM public.orcamentos o
       ORDER BY o.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_listar_orcamentos(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_listar_orcamentos(text) TO anon;

-- 4) admin_atualizar_status_orcamento carimba concluido_em (do addendum 8)
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

REVOKE ALL ON FUNCTION public.admin_atualizar_status_orcamento(text, bigint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_atualizar_status_orcamento(text, bigint, text, text) TO anon;
