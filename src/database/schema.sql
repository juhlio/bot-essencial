-- =============================================================================
-- Essencial Bot — Schema
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tabela: leads
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leads (
  id               SERIAL PRIMARY KEY,
  phone_number     VARCHAR(50)  NOT NULL,
  profile_name     VARCHAR(255),
  name             VARCHAR(255) NOT NULL,
  document_type    VARCHAR(10)  CHECK (document_type IN ('cpf', 'cnpj')),
  document         VARCHAR(20)  NOT NULL,
  company_name     VARCHAR(255),
  email            VARCHAR(255) NOT NULL,
  phone            VARCHAR(20)  NOT NULL,
  segment          VARCHAR(20)  NOT NULL CHECK (segment IN ('venda', 'locacao', 'manutencao')),
  kva_range        INTEGER,
  contract_type    INTEGER,
  equipment_brand  VARCHAR(255),
  equipment_model  VARCHAR(255),
  location         VARCHAR(100),
  is_icp           BOOLEAN      NOT NULL DEFAULT true,
  opt_in_newsletter BOOLEAN,
  tags             TEXT[],
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- Tabela: sessions
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id               SERIAL PRIMARY KEY,
  phone_number     VARCHAR(50)  NOT NULL,
  lead_id          INTEGER      REFERENCES leads(id) ON DELETE SET NULL,
  step             VARCHAR(50)  NOT NULL,
  completed        BOOLEAN      NOT NULL DEFAULT false,
  error_count      INTEGER      DEFAULT 0,
  session_data     JSONB,
  started_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  finished_at      TIMESTAMP WITH TIME ZONE,
  duration_seconds INTEGER GENERATED ALWAYS AS (
    CASE
      WHEN finished_at IS NOT NULL
      THEN EXTRACT(EPOCH FROM (finished_at - started_at))::INTEGER
      ELSE NULL
    END
  ) STORED
);

-- -----------------------------------------------------------------------------
-- Tabela: rd_sync_logs
-- Auditoria de todas as sincronizações com a RD Station.
-- ON DELETE CASCADE: ao remover um lead, remove também seus logs de sync.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rd_sync_logs (
  id               SERIAL PRIMARY KEY,
  lead_id          INTEGER REFERENCES leads(id) ON DELETE CASCADE,
  action           VARCHAR(20) NOT NULL,   -- 'create' | 'update'
  rd_contact_id    INTEGER,
  request_payload  JSONB,
  response_payload JSONB,
  error_message    TEXT,
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- Tabela: message_templates
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS message_templates (
  id          SERIAL PRIMARY KEY,
  key         VARCHAR(50)   NOT NULL UNIQUE,
  category    VARCHAR(30)   NOT NULL,
  label       VARCHAR(100)  NOT NULL,
  content     TEXT          NOT NULL,
  variables   TEXT[]        DEFAULT '{}',
  is_dynamic  BOOLEAN       NOT NULL DEFAULT false,
  description TEXT,
  updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_by  VARCHAR(100)  DEFAULT 'system'
);

-- -----------------------------------------------------------------------------
-- Migrações incrementais
-- Idempotentes: seguras para rodar em bancos já existentes.
-- -----------------------------------------------------------------------------

-- Captura de localização do projeto
ALTER TABLE leads ADD COLUMN IF NOT EXISTS location        VARCHAR(100);

-- Rastreamento de sincronização com RD Station
ALTER TABLE leads ADD COLUMN IF NOT EXISTS rd_contact_id   INTEGER;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS rd_synced_at    TIMESTAMP WITH TIME ZONE;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS rd_sync_error   TEXT;

-- rd_sync_status com DEFAULT e CHECK constraint.
-- O ADD COLUMN IF NOT EXISTS é idempotente para a coluna.
-- O ADD CONSTRAINT usa DO block para ser idempotente (PG não suporta IF NOT EXISTS em constraints).
ALTER TABLE leads ADD COLUMN IF NOT EXISTS rd_sync_status  VARCHAR(20) DEFAULT 'pending';

DO $$
BEGIN
  ALTER TABLE leads
    ADD CONSTRAINT leads_rd_sync_status_check
    CHECK (rd_sync_status IN ('pending', 'synced', 'error', 'skipped'));
EXCEPTION
  WHEN duplicate_object THEN NULL;  -- constraint já existe, ignora
END;
$$;

-- -----------------------------------------------------------------------------
-- Índices
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_leads_phone         ON leads(phone_number);
CREATE INDEX IF NOT EXISTS idx_leads_document      ON leads(document);
CREATE INDEX IF NOT EXISTS idx_leads_segment       ON leads(segment);
CREATE INDEX IF NOT EXISTS idx_leads_created_at    ON leads(created_at);
CREATE INDEX IF NOT EXISTS idx_leads_is_icp        ON leads(is_icp);

-- Índices RD Station: aceleram consultas de status de sync e lookup por contato
CREATE INDEX IF NOT EXISTS idx_leads_rd_contact_id ON leads(rd_contact_id);
CREATE INDEX IF NOT EXISTS idx_leads_rd_synced_at  ON leads(rd_synced_at);

CREATE INDEX IF NOT EXISTS idx_sessions_phone      ON sessions(phone_number);
CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at);

CREATE INDEX IF NOT EXISTS idx_rd_sync_logs_lead_id ON rd_sync_logs(lead_id);

CREATE INDEX IF NOT EXISTS idx_msg_tpl_key         ON message_templates(key);
CREATE INDEX IF NOT EXISTS idx_msg_tpl_category    ON message_templates(category);
