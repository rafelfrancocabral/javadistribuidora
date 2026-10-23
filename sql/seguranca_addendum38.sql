-- ============================================================================
-- Addendum 38
-- Codigo do orcamento no formato C-XXXX (1 letra + 4 numeros), unico por pedido.
--
-- Substitui o addendum37 (que gerava 5 digitos). Regras:
--   * Formato: 'C-' + 4 digitos -> C-0000 ate C-9999.
--   * Cada orcamento recebe um numero livre, independente do cliente.
--   * Historico: numeros fora do formato (ex.: C-10000), vazios e repetidos
--     sao renumerados. Em caso de repeticao, o pedido mais antigo mantem o
--     numero original.
--   * Trigger garante formato e unicidade em qualquer INSERT/UPDATE.
--
-- Limite: como sao 4 digitos com a letra C, existem 10.000 numeros possiveis.
-- ============================================================================

-- 1) Sequencia ciclica de 0 a 9999
CREATE SEQUENCE IF NOT EXISTS public.orcamentos_codigo_seq
    START WITH 0 MINVALUE 0 MAXVALUE 9999 CYCLE;

ALTER SEQUENCE public.orcamentos_codigo_seq MINVALUE 0;
ALTER SEQUENCE public.orcamentos_codigo_seq RESTART WITH 0;
ALTER SEQUENCE public.orcamentos_codigo_seq MAXVALUE 9999 CYCLE;

-- 2) Alocador: devolve o proximo numero livre no formato C-XXXX
CREATE OR REPLACE FUNCTION public.proximo_codigo_orcamento()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _n   int;
    _i   int := 0;
    _cod text;
BEGIN
    LOOP
        _n   := nextval('public.orcamentos_codigo_seq')::int;
        _cod := 'C-' || lpad(_n::text, 4, '0');

        IF NOT EXISTS (
            SELECT 1 FROM public.orcamentos WHERE codigo_cliente = _cod
        ) THEN
            RETURN _cod;
        END IF;

        _i := _i + 1;
        IF _i >= 10000 THEN
            RAISE EXCEPTION 'Sem numeros de orcamento disponiveis (limite de 10000)'
                USING ERRCODE = 'P0001';
        END IF;
    END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.proximo_codigo_orcamento() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.proximo_codigo_orcamento() TO anon, authenticated;

-- 3) Continua a numeracao logo apos o maior C-XXXX atual
DO $$
DECLARE
    _start int;
BEGIN
    SELECT coalesce(max(right(codigo_cliente, 4)::int), -1) + 1
      INTO _start
      FROM public.orcamentos
     WHERE codigo_cliente ~ '^C-[0-9]{4}$';

    IF _start IS NULL OR _start < 0 OR _start > 9999 THEN
        _start := 0;
    END IF;

    EXECUTE format('ALTER SEQUENCE public.orcamentos_codigo_seq RESTART WITH %s', _start);
END $$;

-- 4) Historico: numeros vazios ou fora do formato C-XXXX recebem numero novo
DO $$
DECLARE
    r    record;
    _new text;
BEGIN
    FOR r IN
        SELECT id
          FROM public.orcamentos
         WHERE codigo_cliente IS NULL
            OR codigo_cliente !~ '^C-[0-9]{4}$'
         ORDER BY id
    LOOP
        _new := public.proximo_codigo_orcamento();
        UPDATE public.orcamentos
           SET codigo_cliente = _new,
               updated_at = now()
         WHERE id = r.id;
    END LOOP;
END $$;

-- 5) Historico: numeros repetidos (mantem o mais antigo de cada numero)
DO $$
DECLARE
    r    record;
    _new text;
BEGIN
    FOR r IN
        SELECT id
          FROM (
            SELECT id,
                   row_number() OVER (PARTITION BY codigo_cliente ORDER BY id) AS rn
              FROM public.orcamentos
             WHERE codigo_cliente IS NOT NULL
          ) t
         WHERE t.rn > 1
         ORDER BY t.id
    LOOP
        _new := public.proximo_codigo_orcamento();
        UPDATE public.orcamentos
           SET codigo_cliente = _new,
               updated_at = now()
         WHERE id = r.id;
    END LOOP;
END $$;

-- 6) Trigger: qualquer numero vazio, fora do formato ou repetido vira C-XXXX
CREATE OR REPLACE FUNCTION public.orcamentos_codigo_unico()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Se o numero nao mudou, nao precisa revalidar.
    IF TG_OP = 'UPDATE'
       AND NEW.codigo_cliente IS NOT DISTINCT FROM OLD.codigo_cliente THEN
        RETURN NEW;
    END IF;

    IF NEW.codigo_cliente IS NULL
       OR NEW.codigo_cliente !~ '^C-[0-9]{4}$'
       OR EXISTS (
            SELECT 1
              FROM public.orcamentos
             WHERE codigo_cliente = NEW.codigo_cliente
               AND id <> coalesce(NEW.id, -1)
       ) THEN
        NEW.codigo_cliente := public.proximo_codigo_orcamento();
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orcamentos_codigo_unico ON public.orcamentos;
CREATE TRIGGER trg_orcamentos_codigo_unico
BEFORE INSERT OR UPDATE ON public.orcamentos
FOR EACH ROW EXECUTE FUNCTION public.orcamentos_codigo_unico();
