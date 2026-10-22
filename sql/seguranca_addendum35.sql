-- ============================================================================
-- Addendum 35
-- Baixa e DEVOLUCAO automatica de estoque conforme o status do pedido.
--
-- Regras:
--   * Entrar em 'concluido'  -> subtrai do estoque as quantidades vendidas.
--   * Sair de 'concluido'    -> devolve ao estoque (cancelado, recebido, etc.).
--   * A baixa/devolucao e controlada por estoque_baixado, entao:
--       - concluir de novo depois de reverter baixa outra vez (correto);
--       - reaplicar 'concluido' num pedido ja concluido nao mexe no estoque.
--   * estoque_baixado_itens guarda exatamente o que foi baixado, para devolver
--     as mesmas quantidades mesmo se o pedido for editado depois.
--   * Itens sem codigo (ex.: "Observacoes") sao ignorados.
--   * Pedidos antigos concluidos antes deste addendum (estoque_baixado = false)
--     NAO sao devolvidos ao sair de 'concluido' (nunca foram baixados).
--
-- Depende de: addendum34.
-- ============================================================================

-- 1) Colunas de controle
ALTER TABLE public.orcamentos
    ADD COLUMN IF NOT EXISTS estoque_baixado boolean NOT NULL DEFAULT false;

ALTER TABLE public.orcamentos
    ADD COLUMN IF NOT EXISTS estoque_baixado_itens jsonb;

-- 2) Funcao de mudanca de status com baixa/devolucao de estoque
CREATE OR REPLACE FUNCTION public.admin_atualizar_status_orcamento(
    _token text, _id bigint, _status text, _status_entrega text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _old_status text;
    _baixado    boolean;
    _itens      jsonb;
    _snapshot   jsonb;
    _lista      jsonb;
    _item       jsonb;
    _cod        text;
    _qty        numeric;
    _novo_snap  jsonb := '[]'::jsonb;
BEGIN
    IF public.admin_requerido(_token) IS NULL THEN
        RAISE EXCEPTION 'Nao autorizado' USING ERRCODE = '42501';
    END IF;

    -- Bloqueia a linha para evitar baixa/devolucao duplicada em concorrencia.
    SELECT o.status, coalesce(o.estoque_baixado, false), o.itens, o.estoque_baixado_itens
      INTO _old_status, _baixado, _itens, _snapshot
      FROM public.orcamentos o
     WHERE o.id = _id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Orcamento nao encontrado' USING ERRCODE = 'P0002';
    END IF;

    -- ------------------------------------------------------------------
    -- ENTRANDO em 'concluido': baixa o estoque (se ainda nao foi baixado)
    -- ------------------------------------------------------------------
    IF _status = 'concluido' AND coalesce(_old_status, '') <> 'concluido' THEN
        IF NOT _baixado THEN
            IF _itens IS NOT NULL AND jsonb_typeof(_itens) = 'array' THEN
                FOR _item IN SELECT value FROM jsonb_array_elements(_itens)
                LOOP
                    _cod := nullif(btrim(coalesce(_item->>'codigo', '')), '');
                    _qty := coalesce(nullif(btrim(coalesce(_item->>'quantidade', '')), '')::numeric, 0);

                    IF _cod IS NOT NULL AND _qty > 0 THEN
                        UPDATE public.produtos
                           SET estoque = coalesce(estoque, 0) - _qty::int,
                               updated_at = now()
                         WHERE codigo = _cod;

                        IF NOT FOUND THEN
                            UPDATE public.produtos
                               SET estoque = coalesce(estoque, 0) - _qty::int,
                                   updated_at = now()
                             WHERE lower(btrim(codigo)) = lower(_cod);
                        END IF;

                        -- Guarda o que realmente foi baixado (para devolver depois).
                        IF FOUND THEN
                            _novo_snap := _novo_snap || jsonb_build_array(
                                jsonb_build_object('codigo', _cod, 'quantidade', _qty::int));
                        END IF;
                    END IF;
                END LOOP;
            END IF;
            _baixado := true;
            _snapshot := _novo_snap;
        END IF;

    -- ------------------------------------------------------------------
    -- SAINDO de 'concluido': devolve o estoque (se havia sido baixado)
    -- ------------------------------------------------------------------
    ELSIF coalesce(_old_status, '') = 'concluido' AND _status <> 'concluido' THEN
        IF _baixado THEN
            -- Usa o snapshot do que foi baixado; se nao existir (pedidos do
            -- addendum34), cai para os itens atuais do pedido.
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

            _baixado := false;
            _snapshot := NULL;
        END IF;
    END IF;

    UPDATE public.orcamentos
       SET status = _status,
           status_entrega = coalesce(_status_entrega, status_entrega),
           updated_at = now(),
           estoque_baixado = _baixado,
           estoque_baixado_itens = _snapshot,
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
