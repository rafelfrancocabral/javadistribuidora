-- ============================================================================
-- Addendum 37
-- Numero unico por orcamento (codigo_cliente).
--
-- Problema: o site gerava o numero a partir do e-mail do cliente
-- (generateClientCode), entao todas as compras do mesmo cliente repetiam o
-- mesmo numero (ex.: D.S FERRAGENS sempre #C-0416).
--
-- Solucao:
--   * Sequencia unica, comecando em 10000 (acima de todos os C-XXXX antigos).
--   * Corrige pedidos sem numero e numeros repetidos no historico.
--   * RPC proximo_codigo_orcamento() entrega um numero novo para o site/painel.
--   * Trigger garante que qualquer numero vazio ou repetido vire um numero novo.
--
-- Depende de: nada (autossuficiente).
-- ============================================================================

-- 1) Sequencia de numeros (5 digitos, acima de todos os C-XXXX antigos)
CREATE SEQUENCE IF NOT EXISTS public.orcamentos_codigo_seq START WITH 10000;

-- 2) Pedidos sem numero recebem um numero novo
UPDATE public.orcamentos
   SET codigo_cliente = 'C-' || nextval('public.orcamentos_codigo_seq')::text,
       updated_at = now()
 WHERE codigo_cliente IS NULL OR btrim(codigo_cliente) = '';

-- 3) Numeros repetidos: mantem o pedido mais antigo (menor id) com o numero
--    original e da um numero novo para os demais.
WITH dup AS (
    SELECT id,
           row_number() OVER (PARTITION BY codigo_cliente ORDER BY id) AS rn
      FROM public.orcamentos
     WHERE codigo_cliente IS NOT NULL AND btrim(codigo_cliente) <> ''
)
UPDATE public.orcamentos o
   SET codigo_cliente = 'C-' || nextval('public.orcamentos_codigo_seq')::text,
       updated_at = now()
  FROM dup
 WHERE o.id = dup.id
   AND dup.rn > 1;

-- 4) Indice para a checagem de unicidade
CREATE INDEX IF NOT EXISTS idx_orcamentos_codigo_cliente
    ON public.orcamentos (codigo_cliente);

-- 5) RPC que entrega o proximo numero (usado pelo site e pelo painel)
CREATE OR REPLACE FUNCTION public.proximo_codigo_orcamento()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN 'C-' || nextval('public.orcamentos_codigo_seq')::text;
END;
$$;

REVOKE ALL ON FUNCTION public.proximo_codigo_orcamento() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.proximo_codigo_orcamento() TO anon, authenticated;

-- 6) Garante numero unico em qualquer INSERT/UPDATE
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
       OR btrim(NEW.codigo_cliente) = ''
       OR EXISTS (
            SELECT 1
              FROM public.orcamentos
             WHERE codigo_cliente = NEW.codigo_cliente
               AND id <> coalesce(NEW.id, -1)
       ) THEN
        NEW.codigo_cliente := 'C-' || nextval('public.orcamentos_codigo_seq')::text;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orcamentos_codigo_unico ON public.orcamentos;
CREATE TRIGGER trg_orcamentos_codigo_unico
BEFORE INSERT OR UPDATE ON public.orcamentos
FOR EACH ROW EXECUTE FUNCTION public.orcamentos_codigo_unico();
