-- ============================================================================
-- Addendum 17: reset da contagem de acessos.
--
--   Contexto: ate agora o site NAO registrava acessos por um bug no front
--   (chamava .catch() num thenable do supabase-js, que so tem .then()).
--   As poucas linhas existentes em public.acessos sao de testes.
--
--   Este script limpa a tabela para a contagem comecar do zero apos a
--   correcao. Nao altera a estrutura nem as funcoes.
-- ============================================================================

DELETE FROM public.acessos;
