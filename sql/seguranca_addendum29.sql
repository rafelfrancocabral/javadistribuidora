-- ============================================================================
-- Addendum 29: origem do orcamento (site vs manual)
-- ============================================================================
-- Adiciona a coluna `origem` em public.orcamentos e propaga em salvar_pedido
-- (site) e admin_salvar_orcamento (painel). admin_listar_orcamentos passa a
-- retornar origem para o dashboard exibir icone diferenciador.
-- ============================================================================

-- 1) Coluna
ALTER TABLE public.orcamentos ADD COLUMN IF NOT EXISTS origem text DEFAULT 'manual';

-- 2) Backfill: pedidos que vieram do site tem status_entrega preenchido.
UPDATE public.orcamentos
   SET origem = 'site'
 WHERE status_entrega IS NOT NULL AND trim(status_entrega) <> ''
   AND (origem IS NULL OR origem = '');

UPDATE public.orcamentos
   SET origem = 'manual'
 WHERE (origem IS NULL OR trim(origem) = '');

-- 3) salvar_pedido (site) grava origem='site' (ou payload.origem se informado).
CREATE OR REPLACE FUNCTION public.salvar_pedido(_payload jsonb, _finalizar boolean DEFAULT false)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _id bigint;
    _email text;
BEGIN
    _email := lower(trim(coalesce(_payload->>'email', '')));
    IF _email = '' THEN
        RAISE EXCEPTION 'Cliente invalido' USING ERRCODE = '22023';
    END IF;

    SELECT o.id INTO _id
      FROM public.orcamentos o
     WHERE lower(trim(o.email)) = _email AND o.status = 'em_andamento'
     ORDER BY o.updated_at DESC
     LIMIT 1;

    IF _id IS NULL THEN
        INSERT INTO public.orcamentos
            (nome_cliente, telefone, email, codigo_cliente, codigo_retirada, itens,
             total, pagamento, status, status_entrega, linha, origem, created_at, updated_at)
        VALUES
            (coalesce(_payload->>'nome_cliente', _email), coalesce(_payload->>'telefone', ''),
             _email, coalesce(_payload->>'codigo_cliente', ''), coalesce(_payload->>'codigo_retirada', ''),
             coalesce(_payload->'itens', '[]'::jsonb), coalesce((_payload->>'total')::numeric, 0),
             coalesce(_payload->>'pagamento', ''),
             CASE WHEN _finalizar THEN 'recebido' ELSE 'em_andamento' END,
             'pendente', coalesce(_payload->>'linha', 'java'),
             coalesce(nullif(_payload->>'origem', ''), 'site'),
             now(), now())
        RETURNING id INTO _id;
    ELSE
        UPDATE public.orcamentos
           SET nome_cliente   = coalesce(_payload->>'nome_cliente', nome_cliente),
               telefone       = coalesce(_payload->>'telefone', telefone),
               codigo_cliente = coalesce(nullif(_payload->>'codigo_cliente', ''), codigo_cliente),
               codigo_retirada = coalesce(nullif(_payload->>'codigo_retirada', ''), codigo_retirada),
               itens          = coalesce(_payload->'itens', itens),
               total          = coalesce((_payload->>'total')::numeric, total),
               pagamento      = coalesce(nullif(_payload->>'pagamento', ''), pagamento),
               status         = CASE WHEN _finalizar THEN 'recebido' ELSE 'em_andamento' END,
               linha          = coalesce(nullif(_payload->>'linha', ''), linha),
               origem         = coalesce(nullif(_payload->>'origem', ''), origem, 'site'),
               updated_at     = now()
         WHERE id = _id;
    END IF;

    RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION public.salvar_pedido(jsonb, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.salvar_pedido(jsonb, boolean) TO anon;

-- 4) admin_salvar_orcamento grava origem (payload.origem ou 'manual').
CREATE OR REPLACE FUNCTION public.admin_salvar_orcamento(_token text, _payload jsonb, _id bigint DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _ret bigint;
BEGIN
    IF public.admin_requerido(_token) IS NULL THEN
        RAISE EXCEPTION 'Nao autorizado' USING ERRCODE = '42501';
    END IF;
    IF _id IS NULL THEN
        INSERT INTO public.orcamentos
            (nome_cliente, telefone, email, codigo_cliente, codigo_retirada, itens,
             total, pagamento, status, status_entrega, linha, origem, created_at, updated_at)
        VALUES
            (coalesce(_payload->>'nome_cliente', ''), coalesce(_payload->>'telefone', ''),
             coalesce(_payload->>'email', ''), coalesce(_payload->>'codigo_cliente', ''),
             coalesce(_payload->>'codigo_retirada', ''), coalesce(_payload->'itens', '[]'::jsonb),
             coalesce((_payload->>'total')::numeric, 0), coalesce(_payload->>'pagamento', ''),
             coalesce(_payload->>'status', 'recebido'), coalesce(_payload->>'status_entrega', NULL),
             coalesce(_payload->>'linha', 'java'),
             coalesce(nullif(_payload->>'origem', ''), 'manual'),
             now(), now())
        RETURNING id INTO _ret;
    ELSE
        UPDATE public.orcamentos
           SET nome_cliente = coalesce(_payload->>'nome_cliente', nome_cliente),
               telefone = coalesce(_payload->>'telefone', telefone),
               email = coalesce(_payload->>'email', email),
               itens = coalesce(_payload->'itens', itens),
               total = coalesce((_payload->>'total')::numeric, total),
               pagamento = coalesce(_payload->>'pagamento', pagamento),
               linha = coalesce(_payload->>'linha', linha),
               origem = coalesce(nullif(_payload->>'origem', ''), origem, 'manual'),
               updated_at = now()
         WHERE id = _id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Orcamento nao encontrado' USING ERRCODE = 'P0002';
        END IF;
        _ret := _id;
    END IF;
    RETURN _ret;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_salvar_orcamento(text, jsonb, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_salvar_orcamento(text, jsonb, bigint) TO anon;

-- 5) admin_listar_orcamentos retorna origem.
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
