-- =============================================================================
-- Migração 006: Melhorias na tabela message_history
-- Adiciona updated_at e expande sender para incluir 'bot'.
-- Idempotente: segura para rodar em bancos já existentes.
-- =============================================================================

-- Adiciona updated_at se ainda não existir
ALTER TABLE message_history ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Recria constraint de sender incluindo 'bot'
-- PostgreSQL não suporta IF NOT EXISTS em DROP CONSTRAINT, então usa DO block.
DO $$
BEGIN
  ALTER TABLE message_history DROP CONSTRAINT message_history_sender_check;
EXCEPTION
  WHEN undefined_object THEN NULL;  -- constraint não existe, ignora
END;
$$;

ALTER TABLE message_history
  ADD CONSTRAINT message_history_sender_check
  CHECK (sender IN ('client', 'bot', 'agent'));
