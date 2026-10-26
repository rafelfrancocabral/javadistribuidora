-- Addendum 41: Escopo por cadastro escolhido (e-mails duplicados)
-- Vincula orçamentos ao cliente_id e faz pedidos/pontos usarem o cadastro escolhido.
-- Pedidos antigos (cliente_id nulo) continuam visíveis pelo e-mail.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Vínculo do orçamento com o cadastro
-- ---------------------------------------------------------------------------
ALTER TABLE public.orcamentos
    ADD COLUMN IF NOT EXISTS cliente_id bigint REFERENCES public.clientes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_orcamentos_cliente_id ON public.orcamentos (cliente_id);

-- ---------------------------------------------------------------------------
-- 2) salvar_pedido: grava/usa cliente_id quando enviado
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
    _cliente_id bigint;
BEGIN
    _email := lower(trim(coalesce(_payload->>'email', '')));
    IF _email = '' THEN
        RAISE EXCEPTION 'Cliente invalido' USING ERRCODE = '22023';
    END IF;

    _cliente_id := nullif(nullif(_payload->>'cliente_id', ''), 'null')::bigint;
    IF _cliente_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.clientes c
             WHERE c.id = _cliente_id
               AND lower(trim(c.email)) = _email
        ) THEN
            _cliente_id := NULL;
        END IF;
    END IF;

    IF _cliente_id IS NOT NULL THEN
        SELECT o.id INTO _id
          FROM public.orcamentos o
         WHERE o.cliente_id = _cliente_id
           AND o.status = 'em_andamento'
         ORDER BY o.updated_at DESC
         LIMIT 1;

        -- Adota um carrinho antigo (sem vínculo) do mesmo e-mail.
        IF _id IS NULL THEN
            SELECT o.id INTO _id
              FROM public.orcamentos o
             WHERE lower(trim(o.email)) = _email
               AND o.cliente_id IS NULL
               AND o.status = 'em_andamento'
             ORDER BY o.updated_at DESC
             LIMIT 1;
            IF _id IS NOT NULL THEN
                UPDATE public.orcamentos SET cliente_id = _cliente_id WHERE id = _id;
            END IF;
        END IF;
    ELSE
        SELECT o.id INTO _id
          FROM public.orcamentos o
         WHERE lower(trim(o.email)) = _email
           AND o.status = 'em_andamento'
         ORDER BY o.updated_at DESC
         LIMIT 1;
    END IF;

    IF _id IS NULL THEN
        INSERT INTO public.orcamentos
            (nome_cliente, telefone, email, cliente_id, codigo_cliente, codigo_retirada, itens,
             total, pagamento, status, status_entrega, linha, origem, created_at, updated_at)
        VALUES
            (coalesce(_payload->>'nome_cliente', _email), coalesce(_payload->>'telefone', ''),
             _email, _cliente_id, coalesce(_payload->>'codigo_cliente', ''), coalesce(_payload->>'codigo_retirada', ''),
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
               cliente_id     = coalesce(_cliente_id, cliente_id),
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

-- ---------------------------------------------------------------------------
-- 3) descartar_pedido: respeita o cadastro escolhido
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.descartar_pedido(text);
CREATE OR REPLACE FUNCTION public.descartar_pedido(_email text, _cliente_id bigint DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    DELETE FROM public.orcamentos
     WHERE status = 'em_andamento'
       AND (
            (_cliente_id IS NOT NULL AND cliente_id = _cliente_id)
         OR (_cliente_id IS NULL AND lower(trim(email)) = lower(trim(coalesce(_email, ''))))
       );
END;
$$;

REVOKE ALL ON FUNCTION public.descartar_pedido(text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.descartar_pedido(text, bigint) TO anon;

-- ---------------------------------------------------------------------------
-- 4) listar_pedidos_cliente: filtra pelo cadastro quando informado
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.listar_pedidos_cliente(text, int);
CREATE OR REPLACE FUNCTION public.listar_pedidos_cliente(
    _email text,
    _limite int DEFAULT 20,
    _cliente_id bigint DEFAULT NULL
)
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
    updated_at     timestamptz,
    razao_social   text,
    cnpj           text,
    telefone       text,
    obs            text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT o.id, o.codigo_cliente, o.codigo_retirada, o.status, o.status_entrega,
           o.pagamento, o.total, o.itens, o.created_at, o.updated_at,
           c.razao_social, c.cnpj, c.telefone, o.obs
      FROM public.orcamentos o
      LEFT JOIN public.clientes c
        ON c.id = coalesce(
             o.cliente_id,
             (SELECT c2.id FROM public.clientes c2
               WHERE lower(trim(c2.email)) = lower(trim(o.email))
               ORDER BY c2.id LIMIT 1)
           )
     WHERE coalesce(trim(_email), '') <> ''
       AND o.status <> 'em_andamento'
       AND (
            (_cliente_id IS NOT NULL AND (o.cliente_id = _cliente_id OR o.cliente_id IS NULL))
         OR (_cliente_id IS NULL)
       )
       AND lower(trim(o.email)) = lower(trim(coalesce(_email, '')))
     ORDER BY o.created_at DESC
     LIMIT greatest(1, least(coalesce(_limite, 20), 50));
$$;
REVOKE ALL ON FUNCTION public.listar_pedidos_cliente(text, int, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listar_pedidos_cliente(text, int, bigint) TO anon;

-- ---------------------------------------------------------------------------
-- 5) Pontos: usa o cadastro escolhido quando informado
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.cliente_calcular_pontos_pedido(text, numeric);
CREATE OR REPLACE FUNCTION public.cliente_calcular_pontos_pedido(
    _email text,
    _total numeric,
    _cliente_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _e text := lower(trim(coalesce(_email,'')));
  _acum numeric := 0;
  _ganhos numeric := 0;
  _found boolean := false;
BEGIN
  _ganhos := public.calcular_pontos_pedido(_total);
  IF _e <> '' THEN
    IF _cliente_id IS NOT NULL THEN
      SELECT COALESCE(cl.pontos,0) INTO _acum
        FROM public.clientes cl
       WHERE cl.id = _cliente_id AND lower(trim(cl.email)) = _e
       LIMIT 1;
      _found := FOUND;
    END IF;
    IF NOT _found THEN
      SELECT COALESCE(cl.pontos,0) INTO _acum
        FROM public.clientes cl WHERE lower(trim(cl.email)) = _e LIMIT 1;
    END IF;
  END IF;
  RETURN jsonb_build_object(
    'pontos_acumulados', COALESCE(_acum,0),
    'pontos_ganhos', COALESCE(_ganhos,0)
  );
END; $$;
REVOKE ALL ON FUNCTION public.cliente_calcular_pontos_pedido(text, numeric, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cliente_calcular_pontos_pedido(text, numeric, bigint) TO anon;

DROP FUNCTION IF EXISTS public.cliente_listar_premios_disponiveis(text);
CREATE OR REPLACE FUNCTION public.cliente_listar_premios_disponiveis(
    _email text,
    _cliente_id bigint DEFAULT NULL
)
RETURNS TABLE(
  id bigint, nome text, pontos_necessarios numeric,
  tipo text, valor_desconto numeric, validade date
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _e text := lower(trim(coalesce(_email,'')));
  _acum numeric := 0;
  _found boolean := false;
BEGIN
  IF _e <> '' THEN
    IF _cliente_id IS NOT NULL THEN
      SELECT COALESCE(cl.pontos,0) INTO _acum
        FROM public.clientes cl
       WHERE cl.id = _cliente_id AND lower(trim(cl.email)) = _e
       LIMIT 1;
      _found := FOUND;
    END IF;
    IF NOT _found THEN
      SELECT COALESCE(cl.pontos,0) INTO _acum
        FROM public.clientes cl WHERE lower(trim(cl.email)) = _e LIMIT 1;
    END IF;
  END IF;
  RETURN QUERY
    SELECT p.id, p.nome, COALESCE(p.pontos_necessarios,0), p.tipo, p.valor_desconto, p.validade
      FROM public.premios p
     WHERE p.ativo = true
       AND COALESCE(p.pontos_necessarios,0) > 0
       AND COALESCE(p.pontos_necessarios,0) <= _acum
       AND (p.validade IS NULL OR p.validade >= current_date)
     ORDER BY p.pontos_necessarios ASC;
END; $$;
REVOKE ALL ON FUNCTION public.cliente_listar_premios_disponiveis(text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cliente_listar_premios_disponiveis(text, bigint) TO anon;

DROP FUNCTION IF EXISTS public.cliente_finalizar_pedido_pontos(text, numeric, bigint, bigint);
CREATE OR REPLACE FUNCTION public.cliente_finalizar_pedido_pontos(
  _email text,
  _total numeric,
  _premio_id bigint DEFAULT NULL,
  _orcamento_id bigint DEFAULT NULL,
  _cliente_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _e text := lower(trim(coalesce(_email,'')));
  _cli public.clientes%ROWTYPE;
  _prem public.premios%ROWTYPE;
  _ganhos numeric := 0;
  _obs text := NULL;
  _acum_final numeric := 0;
  _pct numeric := 0;
BEGIN
  IF _e = '' THEN RAISE EXCEPTION 'Email invalido' USING ERRCODE='22023'; END IF;

  IF _cliente_id IS NOT NULL THEN
    SELECT * INTO _cli FROM public.clientes cl
     WHERE cl.id = _cliente_id AND lower(trim(cl.email)) = _e
     LIMIT 1;
  END IF;
  IF _cli.id IS NULL THEN
    SELECT * INTO _cli FROM public.clientes cl WHERE lower(trim(cl.email)) = _e LIMIT 1;
  END IF;
  IF _cli.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'cliente nao encontrado');
  END IF;

  _ganhos := public.calcular_pontos_pedido(_total);

  UPDATE public.clientes
     SET pontos = COALESCE(pontos,0) + _ganhos,
         ja_comprou_site = true
   WHERE id = _cli.id;

  IF _orcamento_id IS NOT NULL THEN
    UPDATE public.orcamentos
       SET cliente_id = coalesce(cliente_id, _cli.id)
     WHERE id = _orcamento_id;
  END IF;

  IF _premio_id IS NOT NULL THEN
    SELECT * INTO _prem FROM public.premios p WHERE p.id = _premio_id LIMIT 1;
    IF FOUND AND _prem.ativo
       AND (_prem.validade IS NULL OR _prem.validade >= current_date)
       AND (COALESCE(_cli.pontos,0) + _ganhos) >= COALESCE(_prem.pontos_necessarios,0) THEN

      UPDATE public.clientes
         SET pontos = GREATEST(0, COALESCE(pontos,0) - COALESCE(_prem.pontos_necessarios,0)),
             resgates = COALESCE(resgates,0) + 1
       WHERE id = _cli.id;

      INSERT INTO public.resgates
        (cliente_id, cliente_email, premio_id, premio_nome, premio_tipo,
         pontos_gastos, valor_desconto, orcamento_id, created_at)
      VALUES
        (_cli.id, _e, _prem.id, _prem.nome, _prem.tipo,
         COALESCE(_prem.pontos_necessarios,0), _prem.valor_desconto, _orcamento_id, now());

      IF _prem.tipo = 'desconto' AND COALESCE(_prem.valor_desconto,0) > 0 THEN
        _pct := GREATEST(0, LEAST(100, _prem.valor_desconto));
        _obs := 'PREMIO RESGATADO - DESCONTO de ' || to_char(_pct, 'FM9999990.00') || '% (' || _prem.nome || ')';
      ELSE
        _obs := 'PREMIO RESGATADO - BRINDE/BONUS a entregar junto com os produtos: ' || _prem.nome;
      END IF;

      IF _orcamento_id IS NOT NULL THEN
        UPDATE public.orcamentos SET obs = COALESCE(obs,'') ||
             CASE WHEN COALESCE(obs,'') = '' THEN '' ELSE E'\n' END || _obs
         WHERE id = _orcamento_id;
      END IF;
    END IF;
  END IF;

  SELECT COALESCE(pontos,0) INTO _acum_final FROM public.clientes WHERE id = _cli.id;

  RETURN jsonb_build_object(
    'ok', true,
    'pontos_ganhos', COALESCE(_ganhos,0),
    'pontos_acumulados', COALESCE(_acum_final,0),
    'obs', _obs
  );
END;
$$;
REVOKE ALL ON FUNCTION public.cliente_finalizar_pedido_pontos(text, numeric, bigint, bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cliente_finalizar_pedido_pontos(text, numeric, bigint, bigint, bigint) TO anon;

COMMIT;
