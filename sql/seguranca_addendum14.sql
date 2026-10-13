-- ============================================================================
-- Addendum 14: novo usuario admin
--   usuario: rcabral@admin
--   senha:   kobesabauna66   (armazenada como SHA-256 hex, igual ao login)
-- Idempotente: se o usuario ja existir, atualiza a senha/nome.
-- ============================================================================

INSERT INTO public.admins (usuario, nome, senha_hash)
VALUES (
    'rcabral@admin',
    'R Cabral',
    '192c43133c77ab26c9a0074ce0c1ec542cf121a951aed62246e1e455298daf83'
)
ON CONFLICT (usuario) DO UPDATE
    SET senha_hash = EXCLUDED.senha_hash,
        nome       = EXCLUDED.nome;