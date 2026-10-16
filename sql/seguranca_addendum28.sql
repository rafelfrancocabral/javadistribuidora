-- ============================================================
-- Addendum 28: League ordenado por "pontos conquistados" (total ganho)
-- ============================================================
-- Criterio: pontos_conquistados = saldo atual (clientes.pontos)
--                              + soma dos pontos JA GASTOS em resgates
-- Assim o ranking premia quem MAIS COMPRA, sem penalizar quem resgata
-- (o resgate debita pontos do saldo) e sem inflar por troca de premios baratos.
-- Desempate: mais resgates, depois razao social.

DROP FUNCTION IF EXISTS public.admin_listar_league_filtrada(text, int);

CREATE OR REPLACE FUNCTION public.admin_listar_league_filtrada(_token text, _limite int DEFAULT 500)
RETURNS TABLE(
  id bigint,
  razao_social text,
  email text,
  telefone text,
  pontos numeric,
  pontos_conquistados numeric,
  resgates int,
  ja_comprou_site boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.admin_requerido(_token) IS NULL THEN RAISE EXCEPTION 'Nao autorizado' USING ERRCODE='42501'; END IF;
  RETURN QUERY
    SELECT cl.id,
           cl.razao_social,
           cl.email,
           cl.telefone,
           COALESCE(cl.pontos, 0),
           COALESCE(cl.pontos, 0) + COALESCE(r.gastos, 0),
           COALESCE(cl.resgates, 0),
           COALESCE(cl.ja_comprou_site, false)
      FROM public.clientes cl
      LEFT JOIN (
        SELECT cliente_id, SUM(COALESCE(pontos_gastos, 0)) AS gastos
          FROM public.resgates
         GROUP BY cliente_id
      ) r ON r.cliente_id = cl.id
     WHERE COALESCE(cl.ja_comprou_site, false) = true
     ORDER BY (COALESCE(cl.pontos, 0) + COALESCE(r.gastos, 0)) DESC,
              COALESCE(cl.resgates, 0) DESC,
              cl.razao_social ASC
     LIMIT GREATEST(1, LEAST(_limite, 1000));
END; $$;

GRANT EXECUTE ON FUNCTION public.admin_listar_league_filtrada(text, int) TO anon;
REVOKE ALL ON FUNCTION public.admin_listar_league_filtrada(text, int) FROM PUBLIC;
