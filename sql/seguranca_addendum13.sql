-- ============================================================================
-- Addendum 13:
--  Pedido em andamento (carrinho do cliente).
--  - Quando o cliente comeca um pedido no site, criamos um orcamento com
--    status 'em_andamento' com os itens/valor atuais do carrinho.
--  - Enquanto ele mexe no carrinho, o mesmo orcamento e atualizado.
--  - Ao concluir o checkout, esse mesmo orcamento passa para 'recebido'.
--  - Se o carrinho for esvaziado, o rascunho em andamento e removido.
--  O status 'em_andamento' passa a ser aceito em public.orcamentos.status.
-- ============================================================================

-- Cria ou atualiza o pedido do cliente (chave: email). Quando _finalizar=true,
-- o status passa para 'recebido' (fluxo normal). Retorna o id do orcamento.
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
             total, pagamento, status, status_entrega, linha, created_at, updated_at)
        VALUES
            (coalesce(_payload->>'nome_cliente', _email), coalesce(_payload->>'telefone', ''),
             _email, coalesce(_payload->>'codigo_cliente', ''), coalesce(_payload->>'codigo_retirada', ''),
             coalesce(_payload->'itens', '[]'::jsonb), coalesce((_payload->>'total')::numeric, 0),
             coalesce(_payload->>'pagamento', ''),
             CASE WHEN _finalizar THEN 'recebido' ELSE 'em_andamento' END,
             'pendente', coalesce(_payload->>'linha', 'java'), now(), now())
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
               updated_at     = now()
         WHERE id = _id;
    END IF;

    RETURN _id;
END;
$$;

-- Remove o pedido em andamento do cliente (carrinho esvaziado).
CREATE OR REPLACE FUNCTION public.descartar_pedido(_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    DELETE FROM public.orcamentos
     WHERE lower(trim(email)) = lower(trim(coalesce(_email, '')))
       AND status = 'em_andamento';
END;
$$;

REVOKE ALL ON FUNCTION public.salvar_pedido(jsonb, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.descartar_pedido(text)            FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.salvar_pedido(jsonb, boolean) TO anon;
GRANT EXECUTE ON FUNCTION public.descartar_pedido(text)            TO anon;