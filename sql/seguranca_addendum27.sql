-- ============================================================================
-- Addendum 27: Desconto agora é em % (percentual)
-- Atualiza a função de finalizar pedido para gravar a observação com %
-- ============================================================================
CREATE OR REPLACE FUNCTION public.cliente_finalizar_pedido_pontos(
  _email text,
  _total numeric,
  _premio_id bigint DEFAULT NULL,
  _orcamento_id bigint DEFAULT NULL
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

  SELECT * INTO _cli FROM public.clientes cl WHERE lower(trim(cl.email)) = _e LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'cliente nao encontrado');
  END IF;

  _ganhos := public.calcular_pontos_pedido(_total);

  UPDATE public.clientes
     SET pontos = COALESCE(pontos,0) + _ganhos,
         ja_comprou_site = true
   WHERE id = _cli.id;

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
GRANT EXECUTE ON FUNCTION public.cliente_finalizar_pedido_pontos(text,numeric,bigint,bigint) TO anon;
REVOKE ALL ON FUNCTION public.cliente_finalizar_pedido_pontos(text,numeric,bigint,bigint) FROM PUBLIC;
