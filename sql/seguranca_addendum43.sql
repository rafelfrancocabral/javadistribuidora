-- Addendum 43: Buscar carrinho (rascunho em_andamento) do cliente para restauração.
-- Permite que o carrinho persista entre sessões/dispositivos enquanto o cliente
-- não concluir a venda.
BEGIN;

CREATE OR REPLACE FUNCTION public.buscar_carrinho_cliente(
    _email text,
    _cliente_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _email_norm text;
    _itens jsonb;
    _oid bigint;
BEGIN
    _email_norm := lower(trim(coalesce(_email, '')));
    IF _email_norm = '' THEN
        RETURN NULL;
    END IF;

    IF _cliente_id IS NOT NULL THEN
        SELECT o.id, o.itens INTO _oid, _itens
          FROM public.orcamentos o
         WHERE o.cliente_id = _cliente_id
           AND lower(trim(o.email)) = _email_norm
           AND o.status = 'em_andamento'
         ORDER BY o.updated_at DESC
         LIMIT 1;

        -- Adota carrinho antigo sem vínculo do mesmo e-mail
        IF _oid IS NULL THEN
            SELECT o.id, o.itens INTO _oid, _itens
              FROM public.orcamentos o
             WHERE o.cliente_id IS NULL
               AND lower(trim(o.email)) = _email_norm
               AND o.status = 'em_andamento'
             ORDER BY o.updated_at DESC
             LIMIT 1;
            IF _oid IS NOT NULL THEN
                UPDATE public.orcamentos SET cliente_id = _cliente_id WHERE id = _oid;
            END IF;
        END IF;
    ELSE
        SELECT o.id, o.itens INTO _oid, _itens
          FROM public.orcamentos o
         WHERE lower(trim(o.email)) = _email_norm
           AND o.status = 'em_andamento'
         ORDER BY o.updated_at DESC
         LIMIT 1;
    END IF;

    IF _oid IS NULL OR _itens IS NULL OR jsonb_typeof(_itens) <> 'array' THEN
        RETURN NULL;
    END IF;

    RETURN jsonb_build_object('id', _oid, 'itens', _itens);
END;
$$;

REVOKE ALL ON FUNCTION public.buscar_carrinho_cliente(text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.buscar_carrinho_cliente(text, bigint) TO anon;

NOTIFY pgrst, 'reload schema';

COMMIT;
