-- ============================================================================
-- Addendum 24: Pontos automáticos na compra + prêmios (desconto/brinde) + resgates
-- ============================================================================

-- 1) Tipos de prêmio e valor do desconto
ALTER TABLE public.premios ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'brinde';
ALTER TABLE public.premios ADD COLUMN IF NOT EXISTS valor_desconto numeric(12,2);
DO $do$ BEGIN
  ALTER TABLE public.premios ADD CONSTRAINT chk_premio_tipo CHECK (tipo IN ('desconto','brinde'));
EXCEPTION WHEN duplicate_object THEN NULL; END $do$;

-- 2) Tabela de resgates (atualiza o menu League)
CREATE TABLE IF NOT EXISTS public.resgates (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cliente_id bigint,
  cliente_email text,
  premio_id bigint,
  premio_nome text,
  premio_tipo text,
  pontos_gastos numeric(10,2) NOT NULL DEFAULT 0,
  valor_desconto numeric(12,2),
  orcamento_id bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.resgates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.resgates FROM anon;
CREATE INDEX IF NOT EXISTS idx_resgates_cliente ON public.resgates (cliente_id);
CREATE INDEX IF NOT EXISTS idx_resgates_created ON public.resgates (created_at DESC);

-- 3) Coluna de observações no orçamento (brinde/bônus a entregar)
ALTER TABLE public.orcamentos ADD COLUMN IF NOT EXISTS obs text;

-- 4) Recalcular prêmios existentes para o novo formato
UPDATE public.premios SET tipo = 'brinde' WHERE tipo IS NULL;

-- 5) Cálculo de pontos de um pedido (conversor R$ -> pontos, melhor regra ativa)
CREATE OR REPLACE FUNCTION public.calcular_pontos_pedido(_total numeric)
RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _r record;
  _best_min numeric := 0;
  _best_pts numeric := 0;
BEGIN
  IF _total IS NULL OR _total <= 0 THEN RETURN 0; END IF;
  FOR _r IN
    SELECT valor_compra_min, pontos
      FROM public.regras_pontuacao
     WHERE ativo = true
       AND COALESCE(valor_compra_min,0) > 0
       AND COALESCE(pontos,0) > 0
       AND (validade IS NULL OR validade >= current_date)
       AND valor_compra_min <= _total
     ORDER BY valor_compra_min DESC
     LIMIT 1
  LOOP
    _best_min := _r.valor_compra_min;
    _best_pts := _r.pontos;
  END LOOP;
  IF _best_min > 0 THEN
    RETURN floor(_total / _best_min) * _best_pts;
  END IF;
  RETURN 0;
END; $$;

-- 6) Resumo de pontos do cliente (chamado pelo site no checkout)
CREATE OR REPLACE FUNCTION public.cliente_calcular_pontos_pedido(_email text, _total numeric)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _e text := lower(trim(coalesce(_email,'')));
  _acum numeric := 0;
  _ganhos numeric := 0;
BEGIN
  _ganhos := public.calcular_pontos_pedido(_total);
  IF _e <> '' THEN
    SELECT COALESCE(cl.pontos,0) INTO _acum
      FROM public.clientes cl WHERE lower(trim(cl.email)) = _e LIMIT 1;
  END IF;
  RETURN jsonb_build_object(
    'pontos_acumulados', COALESCE(_acum,0),
    'pontos_ganhos', COALESCE(_ganhos,0)
  );
END; $$;

-- 7) Prêmios que o cliente pode resgatar agora
CREATE OR REPLACE FUNCTION public.cliente_listar_premios_disponiveis(_email text)
RETURNS TABLE(
  id bigint, nome text, pontos_necessarios numeric,
  tipo text, valor_desconto numeric, validade date
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _e text := lower(trim(coalesce(_email,'')));
  _acum numeric := 0;
BEGIN
  IF _e <> '' THEN
    SELECT COALESCE(cl.pontos,0) INTO _acum
      FROM public.clientes cl WHERE lower(trim(cl.email)) = _e LIMIT 1;
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

-- 8) Finalizar pedido: soma pontos, resgata prêmio e atualiza League
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
        _obs := 'PREMIO RESGATADO — DESCONTO de R$ ' ||
                to_char(_prem.valor_desconto, 'FM9999990.00') || ' (' || _prem.nome || ')';
      ELSE
        _obs := 'PREMIO RESGATADO — BRINDE/BONUS a entregar junto com os produtos: ' || _prem.nome;
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
END; $$;

-- 9) Admin: listar prêmios com tipo e desconto
DROP FUNCTION IF EXISTS public.admin_listar_premios(text);
CREATE OR REPLACE FUNCTION public.admin_listar_premios(_token text)
RETURNS TABLE(
  id bigint, nome text, pontos_necessarios numeric, quantidade integer,
  ativo boolean, validade date, tipo text, valor_desconto numeric, created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.admin_requerido(_token) IS NULL THEN
    RAISE EXCEPTION 'Nao autorizado' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
    SELECT pr.id, pr.nome, pr.pontos_necessarios, pr.quantidade, pr.ativo,
           pr.validade, pr.tipo, pr.valor_desconto, pr.created_at
      FROM public.premios pr
     ORDER BY pr.ativo DESC, pr.pontos_necessarios ASC, pr.nome ASC;
END; $$;

-- 10) Admin: salvar prêmio com tipo e valor do desconto
DROP FUNCTION IF EXISTS public.admin_salvar_premio(text,bigint,text,numeric,int,boolean,date);
CREATE OR REPLACE FUNCTION public.admin_salvar_premio(
  _token text,
  _id bigint DEFAULT NULL,
  _nome text DEFAULT NULL,
  _pontos_necessarios numeric DEFAULT NULL,
  _quantidade integer DEFAULT NULL,
  _ativo boolean DEFAULT true,
  _validade date DEFAULT NULL,
  _tipo text DEFAULT 'brinde',
  _valor_desconto numeric DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _ret bigint;
  _tp text;
BEGIN
  IF public.admin_requerido(_token) IS NULL THEN
    RAISE EXCEPTION 'Nao autorizado' USING ERRCODE='42501';
  END IF;
  _tp := lower(trim(coalesce(_tipo,'brinde')));
  IF _tp NOT IN ('desconto','brinde') THEN _tp := 'brinde'; END IF;
  IF _id IS NULL THEN
    INSERT INTO public.premios(nome, pontos_necessarios, quantidade, ativo, validade, tipo, valor_desconto, updated_at)
    VALUES (nullif(trim(coalesce(_nome,'')),''), _pontos_necessarios, _quantidade,
            COALESCE(_ativo,true), _validade, _tp,
            CASE WHEN _tp = 'desconto' THEN _valor_desconto ELSE NULL END, now())
    RETURNING id INTO _ret;
  ELSE
    UPDATE public.premios
       SET nome = nullif(trim(coalesce(_nome,'')),''),
           pontos_necessarios = _pontos_necessarios,
           quantidade = _quantidade,
           ativo = COALESCE(_ativo,true),
           validade = _validade,
           tipo = _tp,
           valor_desconto = CASE WHEN _tp = 'desconto' THEN _valor_desconto ELSE NULL END,
           updated_at = now()
     WHERE id = _id
    RETURNING id INTO _ret;
  END IF;
  RETURN _ret;
END; $$;

-- Grants
GRANT EXECUTE ON FUNCTION public.calcular_pontos_pedido(numeric) TO anon;
GRANT EXECUTE ON FUNCTION public.cliente_calcular_pontos_pedido(text,numeric) TO anon;
GRANT EXECUTE ON FUNCTION public.cliente_listar_premios_disponiveis(text) TO anon;
GRANT EXECUTE ON FUNCTION public.cliente_finalizar_pedido_pontos(text,numeric,bigint,bigint) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_listar_premios(text) TO anon;
GRANT EXECUTE ON FUNCTION public.admin_salvar_premio(text,bigint,text,numeric,int,boolean,date,text,numeric) TO anon;

REVOKE ALL ON FUNCTION public.calcular_pontos_pedido(numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cliente_calcular_pontos_pedido(text,numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cliente_listar_premios_disponiveis(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cliente_finalizar_pedido_pontos(text,numeric,bigint,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_listar_premios(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_salvar_premio(text,bigint,text,numeric,int,boolean,date,text,numeric) FROM PUBLIC;

-- ============================================================================
-- 11) Expor a coluna obs (brinde/bônus e desconto resgatados) nas listagens
-- ============================================================================

-- 11.1) Dashboard: admin_listar_orcamentos agora retorna obs
DROP FUNCTION IF EXISTS public.admin_listar_orcamentos(text);
CREATE OR REPLACE FUNCTION public.admin_listar_orcamentos(_token text)
RETURNS TABLE (id bigint, nome_cliente text, telefone text, email text,
               codigo_cliente text, codigo_retirada text, itens jsonb, total numeric,
               pagamento text, status text, status_entrega text, linha text,
               created_at timestamptz, updated_at timestamptz, concluido_em timestamptz,
               obs text)
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
             o.status_entrega, o.linha, o.created_at, o.updated_at, o.concluido_em,
             o.obs
      FROM public.orcamentos o
      ORDER BY o.created_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_listar_orcamentos(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_listar_orcamentos(text) TO anon;

-- 11.2) Site (Meus Pedidos): listar_pedidos_cliente agora retorna obs
DROP FUNCTION IF EXISTS public.listar_pedidos_cliente(text, int);
CREATE OR REPLACE FUNCTION public.listar_pedidos_cliente(_email text, _limite int DEFAULT 20)
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
      LEFT JOIN public.clientes c ON lower(trim(c.email)) = lower(trim(o.email))
     WHERE lower(trim(o.email)) = lower(trim(coalesce(_email, '')))
       AND coalesce(trim(_email), '') <> ''
       AND o.status <> 'em_andamento'
     ORDER BY o.created_at DESC
     LIMIT greatest(1, least(coalesce(_limite, 20), 50));
$$;
REVOKE ALL ON FUNCTION public.listar_pedidos_cliente(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listar_pedidos_cliente(text, int) TO anon;
