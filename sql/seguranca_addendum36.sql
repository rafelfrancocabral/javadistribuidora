-- ============================================================================
-- Addendum 36
-- Devolucao de estoque ao EXCLUIR um pedido/orcamento.
--
-- Regra:
--   * Se o pedido tinha estoque baixado (estoque_baixado = true), devolve ao
--     estoque exatamente o que foi baixado antes de apagar o registro.
--   * Usa o snapshot estoque_baixado_itens (o que realmente saiu). Se nao
--     existir (pedidos do addendum34), cai para os itens atuais do pedido.
--   * Pedidos sem baixa (estoque_baixado = false) sao apenas excluidos.
--   * Carrinhos "em_andamento" (descartar_pedido) nunca tem baixa e seguem
--     inalterados.
--
-- Depende de: addendum35.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_excluir_orcamento(_token text, _id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _baixado  boolean;
    _snapshot jsonb;
    _itens    jsonb;
    _lista    jsonb;
    _item     jsonb;
    _cod      text;
    _qty      numeric;
BEGIN
    IF public.admin_requerido(_token) IS NULL THEN
        RAISE EXCEPTION 'Nao autorizado' USING ERRCODE = '42501';
    END IF;

    SELECT coalesce(o.estoque_baixado, false), o.estoque_baixado_itens, o.itens
      INTO _baixado, _snapshot, _itens
      FROM public.orcamentos o
     WHERE o.id = _id
       FOR UPDATE;

    -- Pedido inexistente: nada a fazer (idempotente).
    IF NOT FOUND THEN
        RETURN TRUE;
    END IF;

    -- Devolve o estoque antes de excluir, se houve baixa.
    IF _baixado THEN
        _lista := coalesce(_snapshot, _itens);

        IF _lista IS NOT NULL AND jsonb_typeof(_lista) = 'array' THEN
            FOR _item IN SELECT value FROM jsonb_array_elements(_lista)
            LOOP
                _cod := nullif(btrim(coalesce(_item->>'codigo', '')), '');
                _qty := coalesce(nullif(btrim(coalesce(_item->>'quantidade', '')), '')::numeric, 0);

                IF _cod IS NOT NULL AND _qty > 0 THEN
                    UPDATE public.produtos
                       SET estoque = coalesce(estoque, 0) + _qty::int,
                           updated_at = now()
                     WHERE codigo = _cod;

                    IF NOT FOUND THEN
                        UPDATE public.produtos
                           SET estoque = coalesce(estoque, 0) + _qty::int,
                               updated_at = now()
                         WHERE lower(btrim(codigo)) = lower(_cod);
                    END IF;
                END IF;
            END LOOP;
        END IF;
    END IF;

    DELETE FROM public.orcamentos WHERE id = _id;
    RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_excluir_orcamento(text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_excluir_orcamento(text, bigint) TO anon;
