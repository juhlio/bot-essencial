-- =============================================================================
-- Migração 005: Histórico de mensagens para atendimento humano
-- Idempotente: segura para rodar em bancos já existentes.
-- =============================================================================

CREATE TABLE IF NOT EXISTS message_history (
  id           SERIAL PRIMARY KEY,
  phone_from   VARCHAR(50)  NOT NULL,
  message_text TEXT         NOT NULL,
  sender       VARCHAR(20)  NOT NULL DEFAULT 'client',
  session_id   INTEGER      REFERENCES sessions(id) ON DELETE SET NULL,
  created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Constraint CHECK idempotente para sender
DO $$
BEGIN
  ALTER TABLE message_history
    ADD CONSTRAINT message_history_sender_check
    CHECK (sender IN ('client', 'agent'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_message_history_phone_from  ON message_history(phone_from);
CREATE INDEX IF NOT EXISTS idx_message_history_created_at  ON message_history(created_at);
CREATE INDEX IF NOT EXISTS idx_message_history_session_id  ON message_history(session_id);
