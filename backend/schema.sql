-- ============================================================
-- roomcraft database schema
-- Run once: psql -U postgres -d roomcraft -f schema.sql
-- ============================================================

-- ── Users ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                  SERIAL PRIMARY KEY,
  name                VARCHAR(100)  NOT NULL,
  email               VARCHAR(255)  UNIQUE NOT NULL,
  password_hash       TEXT          NOT NULL,
  profession          VARCHAR(150),
  avatar_url          TEXT,
  is_verified         BOOLEAN       DEFAULT FALSE,
  onboarding_complete BOOLEAN       DEFAULT FALSE,
  created_at          TIMESTAMPTZ   DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   DEFAULT NOW()
);

-- ── OTPs ─────────────────────────────────────────────────────
-- otp_code stored as bcrypt hash — never plaintext
CREATE TABLE IF NOT EXISTS otps (
  id          SERIAL      PRIMARY KEY,
  email       VARCHAR(255) NOT NULL,
  otp_code    TEXT         NOT NULL,
  purpose     VARCHAR(50)  NOT NULL,   -- 'register' | 'reset_password'
  is_used     BOOLEAN      DEFAULT FALSE,
  expires_at  TIMESTAMPTZ  NOT NULL,
  created_at  TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_otps_email_purpose
  ON otps (email, purpose)
  WHERE is_used = FALSE;

-- ── Onboarding responses ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS onboarding_responses (
  id             SERIAL  PRIMARY KEY,
  user_id        INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  source         VARCHAR(100),     -- 'Instagram' | 'A friend' | ...
  first_time     BOOLEAN,          -- first time using a room design app?
  wants_to_shape BOOLEAN,          -- wants to help shape features?
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── Designs ──────────────────────────────────────────────────
-- Each saved room design belongs to one user.
-- furniture and openings stored as JSONB for flexible schema.
CREATE TABLE IF NOT EXISTS designs (
  id           SERIAL  PRIMARY KEY,
  user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name         VARCHAR(100) NOT NULL DEFAULT 'Untitled Design',
  room_type    VARCHAR(60),
  room_width   DECIMAL(6,2),
  room_length  DECIMAL(6,2),
  style        VARCHAR(40),
  furniture    JSONB    NOT NULL DEFAULT '[]',
  openings     JSONB    NOT NULL DEFAULT '[]',
  wall_colors  JSONB    NOT NULL DEFAULT '{}',
  floor_type   VARCHAR(40),
  wall_height  DECIMAL(5,2) NOT NULL DEFAULT 8,   -- ceiling / wall height in ft (8–15)
  connections  JSONB    NOT NULL DEFAULT '[]',  -- [{ design_id, door_id, wall }] connected rooms
  thumbnail    TEXT,            -- base64 or URL of a screenshot
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Existing databases: CREATE TABLE above won't add the column, so this does.
ALTER TABLE designs ADD COLUMN IF NOT EXISTS connections JSONB NOT NULL DEFAULT '[]';
ALTER TABLE designs ADD COLUMN IF NOT EXISTS wall_height DECIMAL(5,2) NOT NULL DEFAULT 8;

CREATE INDEX IF NOT EXISTS idx_designs_user_id
  ON designs (user_id, created_at DESC);

-- ── Helper: auto-update updated_at on any row change ─────────
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_designs_updated_at
  BEFORE UPDATE ON designs
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
