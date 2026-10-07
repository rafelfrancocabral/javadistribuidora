-- Addendum isolado (seguro rodar 2x): protege preco_custo e cria a leitura admin
REVOKE SELECT (preco_custo) ON public.produtos FROM anon;

CREATE OR REPLACE FUNCTION public.admin_listar_produtos(_token text)
RETURNS TABLE (id bigint, codigo text, nome text, marca text, categoria text,
               subcategoria text, unidade text, preco numeric, preco_custo numeric,
               estoque integer, icmsst numeric, embalagem integer, descricao text,
               palavraschave jsonb, imagens jsonb, isdestaque boolean, ispromocao boolean,
               precopromocional numeric, somente_orcamento boolean, visivel boolean,
               linha text, created_at timestamptz, updated_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF public.admin_requerido(_token) IS NULL THEN
        RAISE EXCEPTION 'Nao autorizado' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY SELECT p.id, p.codigo, p.nome, p.marca, p.categoria, p.subcategoria,
                        p.unidade, p.preco, p.preco_custo, p.estoque, p.icmsst,
                        p.embalagem, p.descricao, p.palavraschave, p.imagens,
                        p.isdestaque, p.ispromocao, p.precopromocional,
                        p.somente_orcamento, p.visivel, p.linha, p.created_at, p.updated_at
                 FROM public.produtos p
                 ORDER BY p.id ASC;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_listar_produtos FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_listar_produtos TO anon;