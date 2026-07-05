-- Firm + attorney settings (singleton).
-- Replaces NEXT_PUBLIC_FIRM_* env vars as the source of truth for firm-wide
-- branding/contact info used by email templates, the engagement composer, and
-- the admin Settings UI. Env vars remain the fallback when a column is null
-- or the table is unreachable.

CREATE TABLE IF NOT EXISTS firm_settings (
  id                  integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  firm_name           text,
  attorney_name       text,
  attorney_short_name text,
  city                text,
  email               text,
  phone               text,
  street              text,
  state               text,
  zip                 text,
  website             text,
  bar_number          text,
  admitted            text,
  specialization      text,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid
);

ALTER TABLE firm_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read firm_settings" ON firm_settings;
CREATE POLICY "Admins read firm_settings"
  ON firm_settings
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
        AND u.role IN ('admin','attorney')
    )
  );

-- Writes go through the service-role client only (no INSERT/UPDATE policy).

INSERT INTO firm_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
