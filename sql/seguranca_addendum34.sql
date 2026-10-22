-- ============================================================================
-- Addendum 34
-- Baixa automatica de estoque ao concluir um orcamento/pedido.
--
-- Regra:
--   * Quando admin_atualizar_status_orcamento recebe _status = 'concluido',
--     subtrai do estoque de cada produto a quantidade vendida no pedido.
--   * A baixa acontece UMA UNICA VEZ por pedido (coluna estoque_baixado), mesmo
--     que o status seja revertido e voltado para 'concluido'.
--   * Itens sem codigo (ex.: linha de "Observacoes") sao ignorados.
--   * Reverter o status NAO devolve o estoque (a baixa permanece).
--
-- Depende de: addendum30 (versao atual de admin_atualizar_status_orcamento).
-- ============================================================================

-- 1) Flag de controle (garante baixa unica)
ALTER TABLE public.orcamentos
    ADD COLUMN IF NOT EXISTS estoque_baixado boolean NOT NULL DEFAULT false;

-- 2) Funcao de mudanca de status com baixa de estoque
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
    _item       jsonb;
    _cod        text;
    _qty        numeric;
BEGIN
    IF public.admin_requerido(_token) IS NULL THEN
        RAISE EXCEPTION 'Nao autorizado' USING ERRCODE = '42501';
    END IF;

    -- Bloqueia a linha para evitar baixa duplicada em chamadas concorrentes.
    SELECT o.status, coalesce(o.estoque_baixado, false), o.itens
      INTO _old_status, _baixado, _itens
      FROM public.orcamentos o
     WHERE o.id = _id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Orcamento nao encontrado' USING ERRCODE = 'P0002';
    END IF;

    -- Baixa o estoque na transicao para 'concluido' (uma unica vez por pedido).
    IF _status = 'concluido' AND coalesce(_old_status, '') <> 'concluido' AND NOT _baixado THEN
        IF _itens IS NOT NULL AND jsonb_typeof(_itens) = 'array' THEN
            FOR _item IN SELECT value FROM jsonb_array_elements(_itens)
            LOOP
                _cod := nullif(btrim(coalesce(_item->>'codigo', '')), '');
                _qty := coalesce(nullif(btrim(coalesce(_item->>'quantidade', '')), '')::numeric, 0);

                IF _cod IS NOT NULL AND _qty > 0 THEN
                    -- Casamento exato pelo codigo (coluna codigo e UNIQUE).
                    UPDATE public.produtos
                       SET estoque = coalesce(estoque, 0) - _qty::int,
                           updated_at = now()
                     WHERE codigo = _cod;

                    -- Fallback: ignora diferencas de caixa/espacos no codigo.
                    IF NOT FOUND THEN
                        UPDATE public.produtos
                           SET estoque = coalesce(estoque, 0) - _qty::int,
                               updated_at = now()
                         WHERE lower(btrim(codigo)) = lower(_cod);
                    END IF;
                END IF;
            END LOOP;
        END IF;
        _baixado := true;
    END IF;

    UPDATE public.orcamentos
       SET status = _status,
           status_entrega = coalesce(_status_entrega, status_entrega),
           updated_at = now(),
           estoque_baixado = _baixado,
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
