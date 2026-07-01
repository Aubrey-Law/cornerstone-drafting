/*
  # CRM Track — Leads initial schema

  Creates the standalone leads pipeline, separate from the matters table.
  Leads that are hired become matters via a conversion server action (later step).

  1. Rename
    - `lead_activity` → `matter_activity`
      The existing table tracks events on matter rows that are in lead status.
      Renaming frees the `lead_activity` name for the new table below.

  2. New Tables
    - `leads`              — standalone lead records (pre-hire lifecycle)
    - `lead_activity`      — event log keyed to leads.id
    - `lead_tasks`         — follow-up tasks keyed to leads.id

  3. Modified Tables
    - `matters`            — adds `lead_id` back-reference (set at conversion time)

  4. New Views
    - `v_leads_pipeline`   — active leads with computed stage metrics

  5. Triggers
    - `trg_leads_updated_at`      — auto-updates updated_at on any change
    - `trg_leads_status_changed`  — auto-updates status_changed_at on status change

  6. Security
    - RLS enabled on leads, lead_activity, lead_tasks (admin-only via service role)

  Notes
    - existing matter rows with status='lead' are NOT touched
    - referral_source_id is a real FK to referral_sources (table already exists)
    - referral_organization_id stays a plain UUID (referral_organizations not yet built)
*/

-- ─── Rename existing lead_activity → crm_activity ────────────────────────
-- The existing lead_activity table tracks CRM events on matter-based leads.
-- Renamed to crm_activity to free the name for the new leads-native table below,
-- and to distinguish it from matter_activity (the broader matter workflow log).

ALTER TABLE public.lead_activity RENAME TO crm_activity;
ALTER INDEX IF EXISTS idx_lead_activity_matter_time RENAME TO idx_crm_activity_matter_time;

-- ─── leads ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.leads (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Identity
  first_name               TEXT NOT NULL,
  last_name                TEXT NOT NULL,
  email                    TEXT,
  phone                    TEXT,

  -- Co-applicant (spouse/partner) for joint EP leads
  spouse_first_name        TEXT,
  spouse_last_name         TEXT,
  spouse_email             TEXT,
  spouse_phone             TEXT,

  -- Address (for jurisdiction sanity-check)
  street                   TEXT,
  city                     TEXT,
  state                    TEXT,
  zip                      TEXT,

  -- Pipeline
  status                   TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','contacted','consult_booked','consult_held',
           'proposal_sent','hired','lost','nurture')),
  status_changed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  practice_area_interest   TEXT,

  -- Qualification
  estimated_estate_value   NUMERIC,
  has_minor_children       BOOLEAN,
  marital_status           TEXT,
  urgency                  TEXT CHECK (urgency IN ('low','normal','high')),
  qualification_notes      TEXT,

  -- Source attribution
  source_channel           TEXT
    CHECK (source_channel IN ('website','referral','lawmatics_legacy','manual')),
  referral_source_id       UUID REFERENCES public.referral_sources(id) ON DELETE SET NULL,
  referral_organization_id UUID,
  utm_source               TEXT,
  utm_medium               TEXT,
  utm_campaign             TEXT,

  -- Outcome
  lost_reason              TEXT
    CHECK (lost_reason IS NULL OR lost_reason IN
           ('price','timing','went_diy','chose_other_firm','unresponsive','other','manual_delete')),
  lost_notes               TEXT,
  converted_matter_id      UUID REFERENCES public.matters(id) ON DELETE SET NULL,
  converted_at             TIMESTAMPTZ,

  -- Ownership
  owner_user_id            UUID,

  -- Free-form
  internal_notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_leads_status
  ON public.leads(status);

CREATE INDEX IF NOT EXISTS idx_leads_created_at
  ON public.leads(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_leads_owner
  ON public.leads(owner_user_id);

CREATE INDEX IF NOT EXISTS idx_leads_email
  ON public.leads(LOWER(email));

-- ─── lead_activity ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.lead_activity (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id       UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_user_id UUID,
  type          TEXT NOT NULL
    CHECK (type IN ('created','status_change','note','call','email_sent',
           'email_received','sms','meeting','task','document','converted','lost')),
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_lead_activity_lead_created
  ON public.lead_activity(lead_id, created_at DESC);

-- ─── lead_tasks ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.lead_tasks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id      UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_date     DATE,
  title        TEXT NOT NULL,
  description  TEXT,
  status       TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','done','cancelled')),
  assignee     UUID,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_lead_tasks_lead
  ON public.lead_tasks(lead_id);

CREATE INDEX IF NOT EXISTS idx_lead_tasks_status_due
  ON public.lead_tasks(status, due_date) WHERE status = 'open';

-- ─── matters.lead_id back-reference ───────────────────────────────────────

ALTER TABLE public.matters
  ADD COLUMN IF NOT EXISTS lead_id UUID
    REFERENCES public.leads(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_matters_lead_id
  ON public.matters(lead_id);

-- ─── v_leads_pipeline view ────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_leads_pipeline AS
SELECT
  l.id, l.first_name, l.last_name, l.email, l.phone,
  l.status, l.status_changed_at, l.practice_area_interest,
  l.estimated_estate_value, l.urgency,
  l.source_channel, l.created_at,
  EXTRACT(DAY FROM NOW() - l.status_changed_at)::INT AS days_in_stage,
  (SELECT MAX(created_at) FROM public.lead_activity WHERE lead_id = l.id) AS last_activity_at,
  (SELECT COUNT(*) FROM public.lead_tasks
    WHERE lead_id = l.id AND status = 'open' AND due_date < CURRENT_DATE) AS overdue_task_count
FROM public.leads l
WHERE l.status NOT IN ('hired','lost');

-- ─── updated_at trigger ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_leads_updated_at
  BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── status_changed_at trigger ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.leads_track_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_leads_status_changed
  BEFORE UPDATE OF status ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.leads_track_status_change();

-- ─── RLS ──────────────────────────────────────────────────────────────────

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_tasks ENABLE ROW LEVEL SECURITY;
