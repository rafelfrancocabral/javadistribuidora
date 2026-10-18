-- ============================================================================
-- Addendum 31: reclassificar origem dos orcamentos antigos
-- ============================================================================
-- O backfill do addendum 30 (status_entrega NOT NULL -> 'site') classificou
-- erroneamente orcamentos manuais antigos (que tinham status_entrega='pendente'
-- por default da funcao antiga) como 'site'.
--
-- Discriminador confiavel: orcamentos manuais criados pelo painel recebem
-- codigo_cliente no formato 'C-XXXX' (4 digitos). Pedidos do site usam o
-- codigo do cliente (outro formato). Reclassifica com base nisso.
-- ============================================================================
-- 1) Manuais: codigo_cliente 'C-XXXX'
UPDATE public.orcamentos
   SET origem = 'manual'
 WHERE codigo_cliente ~ '^C-[0-9]{4}$';

-- 2) Site: demais que tem status_entrega preenchido ou email de cliente
UPDATE public.orcamentos
   SET origem = 'site'
 WHERE (codigo_cliente IS NULL OR codigo_cliente !~ '^C-[0-9]{4}$')
   AND ( (status_entrega IS NOT NULL AND trim(status_entrega) <> '')
         OR (email IS NOT NULL AND trim(email) <> '') );

-- 3) Restante: manual (default seguro)
UPDATE public.orcamentos
   SET origem = 'manual'
 WHERE origem IS NULL OR trim(origem) = '';

-- 4) Garantir NOT NULL com default (opcional, mas evita NULL futuros)
ALTER TABLE public.orcamentos ALTER COLUMN origem SET DEFAULT 'manual';
ALTER TABLE public.orcamentos ALTER COLUMN origem SET NOT NULL;
