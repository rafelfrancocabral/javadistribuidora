-- ============================================================================
-- Addendum 7: SENHA PADRAO DE PRIMEIRO ACESSO PARA TODOS OS CLIENTES
-- Define a senha 'Novasenha123' (SHA-256 abaixo) para todos os clientes e
-- marca senha_trocada = false -> o sistema obriga a troca no primeiro login.
-- ============================================================================
UPDATE public.clientes
SET senha = '615a5f29a8bbbd58519a83f7c74f38d31db771e7abe6d08535ec3b7761401b52',
    senha_trocada = false;