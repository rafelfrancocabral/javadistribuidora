-- ============================================================================
-- Addendum 25: Edição manual de pontos/resgates do cliente (League)
-- ============================================================================

-- Ajuste manual do saldo de pontos e do total de resgates de um cliente.
-- Substitui os valores atuais (não soma). Uso administrativo.
CREATE OR REPLACE FUNCTION public.admin_ajustar_pontos_cliente(
  _token text,
  _id bigint,
  _pontos numeric DEFAULT 0,
  _resgates integer DEFAULT 0
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.admin_requerido(_token) IS NULL THEN
    RAISE EXCEPTION 'Nao autorizado' USING ERRCODE = '42501';
  END IF;
  IF _id IS NULL THEN
    RAISE EXCEPTION 'Informe o cliente' USING ERRCODE = '22023';
  END IF;

  UPDATE public.clientes
     SET pontos   = GREATEST(0, COALESCE(_pontos, 0)),
         resgates = GREATEST(0, COALESCE(_resgates, 0)),
         ja_comprou_site = true
   WHERE id = _id;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_ajustar_pontos_cliente(text, bigint, numeric, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_ajustar_pontos_cliente(text, bigint, numeric, integer) TO anon;
