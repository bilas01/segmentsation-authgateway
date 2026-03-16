-- SegStation Auth DB — schéma initial
-- Exécuté automatiquement au premier démarrage du container PostgreSQL

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Organizations (clients) ───────────────────────────────────────
CREATE TABLE organizations (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         TEXT        NOT NULL,
  plan         TEXT        NOT NULL DEFAULT 'starter'
                           CHECK (plan IN ('starter','pro','enterprise')),
  max_members  INT         NOT NULL DEFAULT 5,
  instance_url TEXT        NOT NULL,
  instance_key TEXT        NOT NULL,        -- clé JWT partagée avec l'instance
  status       TEXT        NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active','suspended','pending')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_orgs_status ON organizations(status);

-- ── Users ─────────────────────────────────────────────────────────
CREATE TABLE users (
  id                     UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id                 UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email                  TEXT        NOT NULL UNIQUE,
  password_hash          TEXT        NOT NULL,
  role                   TEXT        NOT NULL DEFAULT 'member'
                                     CHECK (role IN ('superadmin','owner','admin','member')),
  active                 BOOLEAN     NOT NULL DEFAULT true,
  force_password_change  BOOLEAN     NOT NULL DEFAULT false,
  last_login             TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email  ON users(email);
CREATE INDEX idx_users_org_id ON users(org_id);

-- ── Auth logs ─────────────────────────────────────────────────────
CREATE TABLE auth_logs (
  id         BIGSERIAL   PRIMARY KEY,
  user_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
  org_id     UUID        REFERENCES organizations(id) ON DELETE SET NULL,
  event      TEXT        NOT NULL,   -- login_success, login_fail, logout, reset_password
  ip         INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_logs_user_id   ON auth_logs(user_id);
CREATE INDEX idx_logs_created   ON auth_logs(created_at DESC);
CREATE INDEX idx_logs_event     ON auth_logs(event);

-- ── Trigger updated_at automatique ───────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_orgs_updated
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_users_updated
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
