-- ============================================================
-- INTAKE REQUIRED FIELDS + MATTER ALERTS source_field
-- Aubrey Law Portal
-- ============================================================

-- Add source_field to matter_alerts so we know which intake field triggered each alert
ALTER TABLE matter_alerts ADD COLUMN IF NOT EXISTS source_field TEXT;

-- ── INTAKE REQUIRED FIELDS ───────────────────────────────────
-- The checklist Claude checks intake responses against when
-- intake_status changes to 'complete'.

CREATE TABLE IF NOT EXISTS intake_required_fields (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  field_path    TEXT NOT NULL UNIQUE,
  label         TEXT NOT NULL,
  alert_title   TEXT NOT NULL,
  alert_detail  TEXT,
  condition     TEXT NOT NULL DEFAULT 'not_null',  -- not_null | not_empty | valid_percentage
  applies_when  JSONB,      -- e.g. {"marital_status": "married"}
  plan_types    TEXT[],     -- null = all plans; e.g. ARRAY['RLT','Will']
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: attorney full access, read-only for everyone else
ALTER TABLE intake_required_fields ENABLE ROW LEVEL SECURITY;

CREATE POLICY "attorneys_full_access_required_fields"
  ON intake_required_fields FOR ALL
  USING (
    (SELECT email FROM auth.users WHERE id = auth.uid()) = 'scott@aubreylegal.com'
  )
  WITH CHECK (
    (SELECT email FROM auth.users WHERE id = auth.uid()) = 'scott@aubreylegal.com'
  );

CREATE POLICY "read_only_required_fields"
  ON intake_required_fields FOR SELECT
  USING (is_active = true);

-- ── SEED: required fields ─────────────────────────────────────

INSERT INTO intake_required_fields (field_path, label, alert_title, alert_detail, condition, applies_when, plan_types)
VALUES
  -- Always required
  ('first_name',         'Client First Name',    'Missing client first name',   'First name is required for all documents.',           'not_null',          NULL,                             NULL),
  ('last_name',          'Client Last Name',     'Missing client last name',    'Last name is required for all documents.',            'not_null',          NULL,                             NULL),
  ('date_of_birth',      'Client Date of Birth', 'Missing client date of birth','Date of birth is required for trust and POA drafts.', 'not_null',          NULL,                             NULL),
  ('address_line1',      'Client Street Address','Missing client street address','Address is required for document execution.',         'not_null',          NULL,                             NULL),
  ('city',               'Client City',          'Missing client city',         NULL,                                                  'not_null',          NULL,                             NULL),
  ('state',              'Client State',         'Missing client state',        NULL,                                                  'not_null',          NULL,                             NULL),
  ('zip',                'Client ZIP',           'Missing client ZIP code',     NULL,                                                  'not_null',          NULL,                             NULL),
  ('county',             'Client County',        'Missing client county',       'County is required for MA real estate deeds.',        'not_null',          NULL,                             NULL),

  -- Married clients
  ('spouse_first_name',  'Spouse First Name',    'Missing spouse first name',   NULL,                                                  'not_null',          '{"marital_status":"married"}',   NULL),
  ('spouse_last_name',   'Spouse Last Name',     'Missing spouse last name',    NULL,                                                  'not_null',          '{"marital_status":"married"}',   NULL),
  ('spouse_dob',         'Spouse Date of Birth', 'Missing spouse date of birth',NULL,                                                  'not_null',          '{"marital_status":"married"}',   NULL),

  -- Minor children
  ('_fid_guardian_client','Guardian (Primary)',  'No primary guardian named',   'A primary guardian must be named for minor children.','not_null',         '{"has_minor_children":true}',    NULL),

  -- Fiduciaries — always required
  ('_fid_personal_rep_client', 'Personal Representative (Primary)', 'No personal representative named', 'A primary personal representative (executor) is required.', 'not_null', NULL, NULL),
  ('_fid_trustee_client',      'Trustee (Primary)',                  'No trustee named',                 'A primary trustee is required for trust-based plans.',       'not_null', NULL, ARRAY['RLT']),
  ('_fid_poa_client',          'POA Agent (Primary)',                'No power of attorney agent named', 'A primary financial POA agent is required.',                 'not_null', NULL, NULL),
  ('_fid_hcp_client',          'Health Care Proxy (Primary)',        'No health care proxy named',       'A primary health care proxy agent is required.',             'not_null', NULL, NULL),

  -- Goals
  ('goals',              'Planning Goals',       'No planning goals selected',  'At least one planning goal should be selected.',      'not_empty',         NULL,                             NULL),

  -- Real estate
  ('real_estate',        'Real Estate',          'Real estate not documented',  'Please list all real property owned.',                'not_empty',         '{"has_real_property":true}',     NULL)

ON CONFLICT (field_path) DO NOTHING;
