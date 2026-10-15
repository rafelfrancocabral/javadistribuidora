-- ============================================================================
-- Addendum 18:
--   Garante que NENHUM orcamento seja finalizado sem a escolha do prazo de
--   pagamento, tanto pelo site quanto manualmente no painel.
--   - salvar_pedido (site): exige pagamento quando _finalizar = true.
--   - admin_salvar_orcamento (painel "Novo Orcamento"): exige pagamento.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Site: cria/atualiza o pedido do cliente (chave: email).
-- Quando _finalizar=true o status vira 'recebido'; nesse caso o prazo de
-- pagamento passa a ser obrigatorio.
-- ---------------------------------------------------------------------------
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

    IF _finalizar AND coalesce(trim(_payload->>'pagamento'), '') = '' THEN
        RAISE EXCEPTION 'Escolha o prazo de pagamento' USING ERRCODE = '22023';
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

-- ---------------------------------------------------------------------------
-- Painel: salvar orcamento manual. O prazo de pagamento e obrigatorio.
-- ---------------------------------------------------------------------------
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
    IF coalesce(trim(_payload->>'pagamento'), '') = '' THEN
        RAISE EXCEPTION 'Selecione o prazo de pagamento' USING ERRCODE = '22023';
    END IF;
    IF _id IS NULL THEN
        INSERT INTO public.orcamentos
            (nome_cliente, telefone, email, codigo_cliente, codigo_retirada, itens,
             total, pagamento, status, status_entrega, linha, created_at, updated_at)
        VALUES
            (coalesce(_payload->>'nome_cliente', ''), coalesce(_payload->>'telefone', ''),
             coalesce(_payload->>'email', ''), coalesce(_payload->>'codigo_cliente', ''),
             coalesce(_payload->>'codigo_retirada', ''), coalesce(_payload->'itens', '[]'::jsonb),
             coalesce((_payload->>'total')::numeric, 0), coalesce(_payload->>'pagamento', ''),
             coalesce(_payload->>'status', 'recebido'), coalesce(_payload->>'status_entrega', 'pendente'),
             coalesce(_payload->>'linha', 'java'), now(), now())
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

REVOKE ALL ON FUNCTION public.salvar_pedido(jsonb, boolean)               FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_salvar_orcamento(text, jsonb, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.salvar_pedido(jsonb, boolean)               TO anon;
GRANT EXECUTE ON FUNCTION public.admin_salvar_orcamento(text, jsonb, bigint) TO anon;
