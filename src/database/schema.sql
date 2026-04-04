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
-- Índices
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_leads_phone       ON leads(phone_number);
CREATE INDEX IF NOT EXISTS idx_leads_document    ON leads(document);
CREATE INDEX IF NOT EXISTS idx_leads_segment     ON leads(segment);
CREATE INDEX IF NOT EXISTS idx_leads_created_at  ON leads(created_at);
CREATE INDEX IF NOT EXISTS idx_leads_is_icp      ON leads(is_icp);

CREATE INDEX IF NOT EXISTS idx_sessions_phone      ON sessions(phone_number);
CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at);
