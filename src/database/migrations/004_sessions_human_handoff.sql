-- =============================================================================
-- Migração 004: Suporte a handoff humano na tabela sessions
-- Idempotente: segura para rodar em bancos já existentes.
-- =============================================================================

-- Marca se a sessão está sendo atendida pelo bot ou por um humano
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS handler_type      VARCHAR(50)  DEFAULT 'bot';

-- Guarda o step anterior do bot para retomar após o atendimento humano
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS previous_step     VARCHAR(100);

-- Registra quando o atendimento humano começou
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS human_started_at  TIMESTAMP WITH TIME ZONE;

-- Constraint CHECK idempotente para handler_type
DO $$
BEGIN
  ALTER TABLE sessions
    ADD CONSTRAINT sessions_handler_type_check
    CHECK (handler_type IN ('bot', 'human'));
EXCEPTION
  WHEN duplicate_object THEN NULL;  -- constraint já existe, ignora
END;
$$;

-- Índice para facilitar busca de sessões em atendimento humano
CREATE INDEX IF NOT EXISTS idx_sessions_handler_type ON sessions(handler_type);
