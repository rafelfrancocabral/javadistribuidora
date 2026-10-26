-- Addendum 42: remove a assinatura antiga de verificar_login (3 argumentos)
-- A versão de 4 argumentos já atende também as chamadas antigas via valor padrão.
BEGIN;

DROP FUNCTION IF EXISTS public.verificar_login(text, text, text);

-- Força o PostgREST a atualizar o cache.
NOTIFY pgrst, 'reload schema';

COMMIT;
