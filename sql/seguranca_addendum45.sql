-- ============================================================================
-- Addendum 45: SELO BLACK NOVEMBER NOS PRODUTOS
-- ----------------------------------------------------------------------------
-- Adiciona a coluna black_friday (false por padrao). O selo, o filtro do
-- catalogo e a ordenacao sao controlados por js/campanha.js (datas/interruptor).
-- Atualiza admin_salvar_produto para gravar/editar o novo campo.
-- ============================================================================
BEGIN;

ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS black_friday BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_produtos_black_friday
    ON public.produtos (black_friday) WHERE black_friday;

-- O anon recebe SELECT por coluna (preco_custo fica oculto — ver addendum 2).
-- Sem esta linha o site nao consegue ler o novo campo.
GRANT SELECT (black_friday) ON public.produtos TO anon;

CREATE OR REPLACE FUNCTION public.admin_salvar_produto(_token text, _payload jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _id bigint;
BEGIN
    IF public.admin_requerido(_token) IS NULL THEN
        RAISE EXCEPTION 'Nao autorizado' USING ERRCODE = '42501';
    END IF;
    _id := (_payload->>'id')::bigint;

    IF _id IS NOT NULL THEN
        UPDATE public.produtos SET
            codigo = coalesce(_payload->>'codigo', codigo),
            nome = coalesce(_payload->>'nome', nome),
            marca = coalesce(_payload->>'marca', marca),
            categoria = coalesce(_payload->>'categoria', categoria),
            subcategoria = CASE WHEN _payload ? 'subcategoria' THEN _payload->>'subcategoria' ELSE subcategoria END,
            unidade = coalesce(_payload->>'unidade', unidade),
            preco = coalesce((_payload->>'preco')::numeric, preco),
            preco_custo = coalesce((_payload->>'preco_custo')::numeric, preco_custo),
            estoque = coalesce((_payload->>'estoque')::integer, estoque),
            icmsst = coalesce((_payload->>'icmsst')::numeric, icmsst),
            embalagem = coalesce((_payload->>'embalagem')::integer, embalagem),
            descricao = coalesce(_payload->>'descricao', descricao),
            palavraschave = coalesce(_payload->'palavraschave', palavraschave),
            imagens = coalesce(_payload->'imagens', imagens),
            isdestaque = coalesce((_payload->>'isdestaque')::boolean, isdestaque),
            ispromocao = coalesce((_payload->>'ispromocao')::boolean, ispromocao),
            precopromocional = coalesce((_payload->>'precopromocional')::numeric, precopromocional),
            black_friday = coalesce((_payload->>'black_friday')::boolean, black_friday),
            somente_orcamento = coalesce((_payload->>'somente_orcamento')::boolean, somente_orcamento),
            visivel = coalesce((_payload->>'visivel')::boolean, visivel),
            linha = coalesce(_payload->>'linha', linha),
            updated_at = now()
        WHERE id = _id;
        IF FOUND THEN
            RETURN _id;
        END IF;
    END IF;

    INSERT INTO public.produtos
        (codigo, nome, marca, categoria, subcategoria, unidade, preco, preco_custo,
         estoque, icmsst, embalagem, descricao, palavraschave, imagens, isdestaque,
         ispromocao, precopromocional, black_friday, somente_orcamento, visivel, linha, created_at, updated_at)
    VALUES
        (coalesce(_payload->>'codigo', 'generated-' || floor(random() * 1000000)::int::text),
         coalesce(_payload->>'nome', 'Sem nome'), coalesce(_payload->>'marca', ''),
         coalesce(_payload->>'categoria', ''), _payload->>'subcategoria',
         coalesce(_payload->>'unidade', 'UN'), coalesce((_payload->>'preco')::numeric, 0),
         coalesce((_payload->>'preco_custo')::numeric, 0),
         coalesce((_payload->>'estoque')::integer, 0), coalesce((_payload->>'icmsst')::numeric, 0),
         coalesce((_payload->>'embalagem')::integer, 1), coalesce(_payload->>'descricao', ''),
         coalesce(_payload->'palavraschave', '[]'::jsonb), coalesce(_payload->'imagens', '[]'::jsonb),
         coalesce((_payload->>'isdestaque')::boolean, false),
         coalesce((_payload->>'ispromocao')::boolean, false),
         coalesce((_payload->>'precopromocional')::numeric, 0),
         coalesce((_payload->>'black_friday')::boolean, false),
         coalesce((_payload->>'somente_orcamento')::boolean, false),
         coalesce((_payload->>'visivel')::boolean, true),
         coalesce(_payload->>'linha', 'java'), now(), now())
    RETURNING id INTO _id;
    RETURN _id;
END;
$$;

-- Forca o PostgREST a atualizar o cache.
NOTIFY pgrst, 'reload schema';

COMMIT;
