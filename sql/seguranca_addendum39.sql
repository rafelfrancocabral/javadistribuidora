-- Addendum 39: Permitir mesmo e-mail para mais de um cliente
-- Remove a restrição de unicidade (case-insensitive) do e-mail na tabela clientes

BEGIN;

-- Remove índice único caso exista
DROP INDEX IF EXISTS public.idx_clientes_email;

-- Remove constraint única caso exista com nome padrão ou variante
DO $$
DECLARE
  _cname text;
BEGIN
  SELECT c.conname
    INTO _cname
  FROM pg_constraint c
  JOIN pg_class t ON c.conrelid = t.oid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'clientes'
    AND c.contype = 'u'
    AND pg_get_constraintdef(c.oid) ILIKE '%email%'
  LIMIT 1;

  IF _cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.clientes DROP CONSTRAINT %I', _cname);
  END IF;
END $$;

COMMIT;
