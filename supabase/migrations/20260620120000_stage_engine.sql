-- Stage engine: business-day SLA, pipeline aging view, nudge schedule/log, stage tasks.
-- Maps legacy lead.status / matter.stage keys to engine stage keys in views.

-- ─── Engine columns ─────────────────────────────────────────────────────────

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS track text CHECK (track IS NULL OR track IN ('LP', 'NONLP')),
  ADD COLUMN IF NOT EXISTS stage_entered_at timestamptz,
  ADD COLUMN IF NOT EXISTS client_name text;

ALTER TABLE public.matters
  ADD COLUMN IF NOT EXISTS track text CHECK (track IS NULL OR track IN ('LP', 'NONLP')),
  ADD COLUMN IF NOT EXISTS stage_entered_at timestamptz,
  ADD COLUMN IF NOT EXISTS client_name text,
  ADD COLUMN IF NOT EXISTS revision_round int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS design_meeting_at timestamptz;

-- Backfill leads
UPDATE public.leads
SET
  client_name = NULLIF(trim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), ''),
  stage_entered_at = COALESCE(stage_entered_at, status_changed_at),
  track = COALESCE(
    track,
    CASE
      WHEN practice_area_interest ILIKE '%EP-LP%'
        OR practice_area_interest = 'Estate Planning | LP'
        OR practice_area_interest ILIKE '%(LP)%'
        THEN 'LP'
      ELSE 'NONLP'
    END
  )
WHERE client_name IS NULL OR stage_entered_at IS NULL OR track IS NULL;

-- Backfill matters (practice_area from matter_details)
UPDATE public.matters m
SET
  client_name = COALESCE(m.client_name, NULLIF(trim(m.name), '')),
  stage_entered_at = COALESCE(m.stage_entered_at, md.open_date::timestamptz, m.created_at),
  track = COALESCE(
    m.track,
    CASE WHEN md.practice_area = 'EP-LP' THEN 'LP' ELSE 'NONLP' END
  )
FROM public.matter_details md
WHERE md.client_id = m.id
  AND (m.client_name IS NULL OR m.stage_entered_at IS NULL OR m.track IS NULL);

UPDATE public.matters m
SET
  client_name = COALESCE(m.client_name, NULLIF(trim(m.name), '')),
  stage_entered_at = COALESCE(m.stage_entered_at, m.created_at),
  track = COALESCE(m.track, 'NONLP')
WHERE m.track IS NULL OR m.stage_entered_at IS NULL;

-- Keep stage_entered_at in sync on lead status changes
CREATE OR REPLACE FUNCTION public.trg_leads_stage_entered_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.stage_entered_at := NOW();
  END IF;
  IF NEW.client_name IS NULL OR NEW.client_name = '' THEN
    NEW.client_name := NULLIF(trim(COALESCE(NEW.first_name, '') || ' ' || COALESCE(NEW.last_name, '')), '');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leads_stage_entered_at ON public.leads;
CREATE TRIGGER trg_leads_stage_entered_at
  BEFORE INSERT OR UPDATE OF status ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.trg_leads_stage_entered_at();

CREATE OR REPLACE FUNCTION public.trg_matters_stage_entered_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.stage IS DISTINCT FROM OLD.stage THEN
    NEW.stage_entered_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_matters_stage_entered_at ON public.matters;
CREATE TRIGGER trg_matters_stage_entered_at
  BEFORE INSERT OR UPDATE OF stage ON public.matters
  FOR EACH ROW EXECUTE FUNCTION public.trg_matters_stage_entered_at();

-- ─── Holidays + business days ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.firm_holidays (
  holiday_date date PRIMARY KEY,
  label text
);

CREATE OR REPLACE FUNCTION public.business_days_elapsed(
  p_start timestamptz,
  p_end timestamptz DEFAULT now()
)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT count(*)::int
  FROM generate_series(
         (p_start AT TIME ZONE 'America/New_York')::date,
         (p_end   AT TIME ZONE 'America/New_York')::date - 1,
         interval '1 day'
       ) AS d(day)
  WHERE extract(isodow FROM d.day) < 6
    AND d.day NOT IN (SELECT holiday_date FROM public.firm_holidays);
$$;

-- ─── Engine stage mapping (legacy -> config keys) ───────────────────────────

CREATE OR REPLACE FUNCTION public.map_lead_status_to_engine_stage(p_status text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_status
    WHEN 'consult_booked' THEN 'discovery_booked'
    WHEN 'consult_held' THEN 'pmps_booked'
    WHEN 'proposal_sent' THEN 'proposal_ea_out'
    WHEN 'engagement_sent' THEN 'ea_pending_signature'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.map_matter_stage_to_engine_stage(p_stage text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_stage
    WHEN 'intake' THEN 'design_input'
    WHEN 'intake_review' THEN 'design_input'
    WHEN 'design' THEN 'design_input'
    WHEN 'drafting' THEN 'drafting'
    WHEN 'client_review' THEN 'client_review'
    WHEN 'revision' THEN 'revisions'
    WHEN 'drafts_approved' THEN 'approved'
    WHEN 'signing_scheduled' THEN 'signing_scheduled'
    WHEN 'signing_complete' THEN 'signing_scheduled'
    WHEN 'post_execution' THEN 'closeout'
    WHEN 'closed' THEN 'matter_closed'
    ELSE NULL
  END;
$$;

-- ─── stage_sla (seed via scripts/seed-stage-sla.ts; bootstrap rows) ─────────

CREATE TABLE IF NOT EXISTS public.stage_sla (
  stage_key text NOT NULL,
  track text NOT NULL CHECK (track IN ('LP', 'NONLP')),
  entity text NOT NULL CHECK (entity IN ('lead', 'matter')),
  owner text NOT NULL CHECK (owner IN ('client', 'attorney')),
  sla_days int,
  escalation_offset int,
  stage_order int NOT NULL,
  PRIMARY KEY (stage_key, track)
);

INSERT INTO public.stage_sla (stage_key, track, entity, owner, sla_days, escalation_offset, stage_order) VALUES
  ('discovery_booked', 'LP', 'lead', 'client', null, null, 1),
  ('discovery_booked', 'NONLP', 'lead', 'client', null, null, 1),
  ('pmps_booked', 'LP', 'lead', 'client', null, null, 2),
  ('pmps_booked', 'NONLP', 'lead', 'client', null, null, 2),
  ('proposal_ea_out', 'LP', 'lead', 'attorney', 1, 1, 3),
  ('proposal_ea_out', 'NONLP', 'lead', 'attorney', 1, 1, 3),
  ('ea_pending_signature', 'LP', 'lead', 'client', 5, 7, 4),
  ('ea_pending_signature', 'NONLP', 'lead', 'client', 5, 7, 4),
  ('design_input', 'LP', 'matter', 'client', 5, 7, 5),
  ('design_input', 'NONLP', 'matter', 'client', 5, 7, 5),
  ('drafting', 'LP', 'matter', 'attorney', 5, 5, 6),
  ('drafting', 'NONLP', 'matter', 'attorney', 5, 5, 6),
  ('client_review', 'LP', 'matter', 'client', 5, 7, 7),
  ('client_review', 'NONLP', 'matter', 'client', 5, 7, 7),
  ('revisions', 'LP', 'matter', 'attorney', 3, 3, 8),
  ('revisions', 'NONLP', 'matter', 'attorney', 3, 3, 8),
  ('approved', 'LP', 'matter', 'client', 5, 7, 9),
  ('approved', 'NONLP', 'matter', 'client', 5, 7, 9),
  ('signing_scheduled', 'LP', 'matter', 'client', null, null, 10),
  ('signing_scheduled', 'NONLP', 'matter', 'client', null, null, 10),
  ('closeout', 'LP', 'matter', 'attorney', 3, 3, 11),
  ('closeout', 'NONLP', 'matter', 'attorney', 3, 3, 11)
ON CONFLICT (stage_key, track) DO UPDATE SET
  entity = EXCLUDED.entity,
  owner = EXCLUDED.owner,
  sla_days = EXCLUDED.sla_days,
  escalation_offset = EXCLUDED.escalation_offset,
  stage_order = EXCLUDED.stage_order;

-- ─── Pipeline aging view ────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_pipeline_aging AS
WITH unified AS (
  SELECT
    'lead'::text AS entity,
    l.id::text AS id,
    l.client_name,
    l.track,
    public.map_lead_status_to_engine_stage(l.status) AS current_stage,
    COALESCE(l.stage_entered_at, l.status_changed_at) AS stage_entered_at
  FROM public.leads l
  WHERE l.status NOT IN ('hired', 'lost', 'nurture', 'new', 'contacted')
    AND l.deleted_at IS NULL
    AND public.map_lead_status_to_engine_stage(l.status) IS NOT NULL

  UNION ALL

  SELECT
    'matter'::text AS entity,
    m.id::text AS id,
    COALESCE(m.client_name, m.name) AS client_name,
    m.track,
    public.map_matter_stage_to_engine_stage(m.stage) AS current_stage,
    COALESCE(m.stage_entered_at, m.created_at) AS stage_entered_at
  FROM public.matters m
  WHERE m.status = 'active'
    AND public.map_matter_stage_to_engine_stage(m.stage) IS NOT NULL
    AND public.map_matter_stage_to_engine_stage(m.stage) <> 'matter_closed'
)
SELECT
  u.entity,
  u.id,
  u.client_name,
  u.track,
  u.current_stage,
  s.stage_order,
  s.owner,
  u.stage_entered_at,
  public.business_days_elapsed(u.stage_entered_at) AS days_in_stage,
  s.sla_days,
  s.escalation_offset,
  (s.sla_days IS NOT NULL
     AND public.business_days_elapsed(u.stage_entered_at) > s.sla_days) AS is_overdue,
  (s.escalation_offset IS NOT NULL
     AND public.business_days_elapsed(u.stage_entered_at) >= s.escalation_offset) AS needs_outreach,
  CASE
    WHEN s.sla_days IS NULL THEN 'green'
    WHEN public.business_days_elapsed(u.stage_entered_at) > s.sla_days THEN 'red'
    WHEN s.escalation_offset IS NOT NULL
         AND public.business_days_elapsed(u.stage_entered_at) >= s.escalation_offset THEN 'red'
    WHEN public.business_days_elapsed(u.stage_entered_at) >= (s.sla_days - 1) THEN 'amber'
    ELSE 'green'
  END AS health,
  CASE WHEN s.sla_days IS NULL THEN NULL
       ELSE public.business_days_elapsed(u.stage_entered_at) - s.sla_days
  END AS days_over_sla
FROM unified u
JOIN public.stage_sla s
  ON s.stage_key = u.current_stage
 AND s.track = u.track;

CREATE OR REPLACE VIEW public.v_matter_aging AS
  SELECT * FROM public.v_pipeline_aging WHERE entity = 'matter';

-- ─── Nudge engine ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.nudge_schedule (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  stage_key text NOT NULL,
  track text NOT NULL CHECK (track IN ('LP', 'NONLP')),
  offset_days int NOT NULL,
  template_key text NOT NULL,
  tier text NOT NULL CHECK (tier IN ('gentle', 'firm', 'escalation')),
  send_mode text NOT NULL CHECK (send_mode IN ('auto', 'approval')),
  condition text,
  UNIQUE (stage_key, track, offset_days, template_key)
);

INSERT INTO public.nudge_schedule (stage_key, track, offset_days, template_key, tier, send_mode, condition) VALUES
  ('ea_pending_signature', 'LP', 3, 'ea_reminder_gentle', 'gentle', 'auto', null),
  ('ea_pending_signature', 'LP', 5, 'ea_reminder_firm', 'firm', 'approval', null),
  ('ea_pending_signature', 'LP', 7, 'ea_reminder_escalation', 'escalation', 'approval', null),
  ('ea_pending_signature', 'NONLP', 3, 'ea_reminder_gentle', 'gentle', 'auto', null),
  ('ea_pending_signature', 'NONLP', 5, 'ea_reminder_firm', 'firm', 'approval', null),
  ('ea_pending_signature', 'NONLP', 7, 'ea_reminder_escalation', 'escalation', 'approval', null),
  ('design_input', 'LP', 3, 'design_questionnaire_reminder', 'gentle', 'auto', null),
  ('design_input', 'LP', 5, 'design_questionnaire_firm', 'firm', 'approval', null),
  ('design_input', 'LP', 7, 'design_questionnaire_firm', 'escalation', 'approval', null),
  ('design_input', 'NONLP', 3, 'design_meeting_unbooked', 'gentle', 'auto', 'meeting_unbooked'),
  ('design_input', 'NONLP', 7, 'design_meeting_unbooked', 'escalation', 'approval', 'meeting_unbooked'),
  ('client_review', 'LP', 3, 'review_reminder_gentle', 'gentle', 'auto', null),
  ('client_review', 'LP', 5, 'review_reminder_firm', 'firm', 'approval', null),
  ('client_review', 'LP', 7, 'review_reminder_escalation', 'escalation', 'approval', null),
  ('client_review', 'NONLP', 3, 'review_reminder_gentle', 'gentle', 'auto', null),
  ('client_review', 'NONLP', 5, 'review_reminder_firm', 'firm', 'approval', null),
  ('client_review', 'NONLP', 7, 'review_reminder_escalation', 'escalation', 'approval', null),
  ('approved', 'LP', 3, 'approved_book_signing', 'gentle', 'auto', null),
  ('approved', 'LP', 5, 'approved_book_signing_firm', 'firm', 'approval', null),
  ('approved', 'LP', 7, 'approved_book_signing_firm', 'escalation', 'approval', null),
  ('approved', 'NONLP', 3, 'approved_book_signing', 'gentle', 'auto', null),
  ('approved', 'NONLP', 5, 'approved_book_signing_firm', 'firm', 'approval', null),
  ('approved', 'NONLP', 7, 'approved_book_signing_firm', 'escalation', 'approval', null)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.nudge_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity text NOT NULL CHECK (entity IN ('lead', 'matter')),
  entity_id text NOT NULL,
  stage_key text NOT NULL,
  stage_entered_at timestamptz NOT NULL,
  offset_days int NOT NULL,
  template_key text NOT NULL,
  send_mode text NOT NULL CHECK (send_mode IN ('auto', 'approval')),
  status text NOT NULL CHECK (status IN ('sending', 'sent', 'queued', 'approved_sent', 'skipped', 'error')),
  detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, stage_entered_at, offset_days, template_key)
);

CREATE TABLE IF NOT EXISTS public.nudge_approvals (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nudge_log_id bigint NOT NULL REFERENCES public.nudge_log(id) ON DELETE CASCADE,
  entity text NOT NULL CHECK (entity IN ('lead', 'matter')),
  entity_id text NOT NULL,
  client_name text,
  tier text,
  template_key text,
  stage_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE VIEW public.v_nudges_due AS
SELECT
  a.entity,
  a.id AS entity_id,
  a.client_name,
  a.track,
  a.current_stage AS stage_key,
  a.stage_entered_at,
  a.days_in_stage,
  ns.offset_days,
  ns.template_key,
  ns.tier,
  ns.send_mode,
  ns.condition
FROM public.v_pipeline_aging a
JOIN public.nudge_schedule ns
  ON ns.stage_key = a.current_stage
 AND ns.track = a.track
WHERE a.owner = 'client'
  AND a.days_in_stage >= ns.offset_days
  AND NOT EXISTS (
    SELECT 1 FROM public.nudge_log l
    WHERE l.entity_id = a.id
      AND l.stage_entered_at = a.stage_entered_at
      AND l.offset_days = ns.offset_days
      AND l.template_key = ns.template_key
  );

-- ─── Attorney stage tasks ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.stage_tasks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  matter_id uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  stage_key text NOT NULL,
  stage_entered_at timestamptz NOT NULL,
  title text NOT NULL,
  task_type text NOT NULL CHECK (task_type IN ('single', 'checklist')),
  soft_due_at timestamptz,
  hard_due_at timestamptz,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'archived')),
  batch_tag text,
  checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (matter_id, stage_key, stage_entered_at)
);

CREATE INDEX IF NOT EXISTS idx_stage_tasks_open ON public.stage_tasks (status, hard_due_at)
  WHERE status = 'open';

GRANT SELECT ON public.v_pipeline_aging TO service_role;
GRANT SELECT ON public.v_matter_aging TO service_role;
GRANT SELECT ON public.v_nudges_due TO service_role;
