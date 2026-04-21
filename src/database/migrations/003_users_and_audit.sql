-- =============================================================================
-- Migração 003: Tabelas de autenticação e auditoria
-- Idempotente: segura para rodar em bancos já existentes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tipo ENUM: user_role
-- DO block garante idempotência (CREATE TYPE não suporta IF NOT EXISTS).
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'viewer');
EXCEPTION
  WHEN duplicate_object THEN NULL;  -- tipo já existe, ignora
END;
$$;

-- -----------------------------------------------------------------------------
-- Tabela: users
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          user_role    NOT NULL DEFAULT 'viewer',
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_login    TIMESTAMP WITH TIME ZONE
);

-- -----------------------------------------------------------------------------
-- Tabela: audit_logs
-- ON DELETE SET NULL: preserva o log mesmo que o usuário seja removido.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action     VARCHAR(100) NOT NULL,
  ip_address VARCHAR(45)  NOT NULL,   -- VARCHAR(45) suporta IPv4 e IPv6
  timestamp  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- Índices
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email           ON users(email);
CREATE        INDEX IF NOT EXISTS idx_audit_logs_user_id    ON audit_logs(user_id);
CREATE        INDEX IF NOT EXISTS idx_audit_logs_timestamp  ON audit_logs(timestamp);
