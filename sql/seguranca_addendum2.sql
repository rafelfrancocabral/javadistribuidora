-- Addendum 2 (isolado e seguro rodar 2x): esconde preco_custo do anon.
-- Motivo: REVOKE de coluna so tem efeito quando o privilegio foi concedido
-- a nivel de coluna. Entao revogamos o SELECT da tabela e regrantamos
-- coluna a coluna (sem preco_custo).
REVOKE SELECT ON public.produtos FROM anon;

GRANT SELECT (id, codigo, nome, marca, categoria, subcategoria, preco, unidade,
              descricao, palavraschave, imagens, video, visivel, estoque,
              isdestaque, ispromocao, precopromocional, somente_orcamento,
              linha, icmsst, embalagem, created_at, updated_at)
    ON public.produtos TO anon;