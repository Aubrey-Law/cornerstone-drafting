-- Cornerstone Lite — matter-only pipeline aging (no leads).
-- Adapted from archived portal stage_engine + pipeline_aging_enhancements.

-- ─── Holidays + business days ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.firm_holidays (
  holiday_date date PRIMARY KEY,
  name text
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

-- ─── Engine stage mapping (legacy matter.stage -> config keys) ──────────────

CREATE OR REPLACE FUNCTION public.map_matter_stage_to_engine(p_stage text)
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

-- ─── stage_sla (DEFAULT track, matter entity only) ──────────────────────────

CREATE TABLE IF NOT EXISTS public.stage_sla (
  stage_key text NOT NULL,
  track text NOT NULL DEFAULT 'DEFAULT',
  sla_days int,
  escalation_offset int,
  owner text NOT NULL CHECK (owner IN ('client', 'attorney')),
  stage_order int NOT NULL,
  entity text NOT NULL DEFAULT 'matter' CHECK (entity = 'matter'),
  PRIMARY KEY (stage_key, track)
);

INSERT INTO public.stage_sla (stage_key, track, entity, owner, sla_days, escalation_offset, stage_order) VALUES
  ('design_input', 'DEFAULT', 'matter', 'client', 5, 4, 1),
  ('drafting', 'DEFAULT', 'matter', 'attorney', 5, 4, 2),
  ('client_review', 'DEFAULT', 'matter', 'client', 5, 4, 3),
  ('revisions', 'DEFAULT', 'matter', 'attorney', 3, 2, 4),
  ('approved', 'DEFAULT', 'matter', 'client', 5, 4, 5),
  ('signing_scheduled', 'DEFAULT', 'matter', 'client', null, null, 6),
  ('closeout', 'DEFAULT', 'matter', 'attorney', 3, 2, 7)
ON CONFLICT (stage_key, track) DO UPDATE SET
  entity = EXCLUDED.entity,
  owner = EXCLUDED.owner,
  sla_days = EXCLUDED.sla_days,
  escalation_offset = EXCLUDED.escalation_offset,
  stage_order = EXCLUDED.stage_order;

ALTER TABLE public.stage_sla ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'stage_sla' AND policyname = 'attorneys_read_stage_sla'
  ) THEN
    CREATE POLICY "attorneys_read_stage_sla"
      ON public.stage_sla FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'stage_sla' AND policyname = 'attorneys_update_stage_sla'
  ) THEN
    CREATE POLICY "attorneys_update_stage_sla"
      ON public.stage_sla FOR UPDATE TO authenticated
      USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')))
      WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')));
  END IF;
END $$;

-- ─── Snooze (matter entity only) ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.pipeline_aging_snooze (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity text NOT NULL CHECK (entity = 'matter'),
  entity_id text NOT NULL,
  stage_key text NOT NULL,
  snoozed_until timestamptz NOT NULL,
  snoozed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity, entity_id, stage_key)
);

CREATE INDEX IF NOT EXISTS idx_pipeline_aging_snooze_active
  ON public.pipeline_aging_snooze (entity, entity_id, snoozed_until DESC);

ALTER TABLE public.pipeline_aging_snooze ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'pipeline_aging_snooze'
      AND policyname = 'attorneys_all_pipeline_aging_snooze'
  ) THEN
    CREATE POLICY "attorneys_all_pipeline_aging_snooze"
      ON public.pipeline_aging_snooze FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')))
      WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')));
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pipeline_aging_snooze TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.pipeline_aging_snooze_id_seq TO service_role;
GRANT SELECT ON public.stage_sla TO service_role;
GRANT SELECT ON public.firm_holidays TO service_role;

-- ─── Keep stage_entered_at in sync on matter stage changes ──────────────────

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

-- Backfill stage_entered_at / track for existing matters
UPDATE public.matters
SET
  stage_entered_at = COALESCE(stage_entered_at, created_at, now()),
  track = COALESCE(NULLIF(track, ''), 'DEFAULT')
WHERE stage_entered_at IS NULL OR track IS NULL OR track = '';

-- ─── Matter aging view ──────────────────────────────────────────────────────

DROP VIEW IF EXISTS public.v_matter_aging;

CREATE VIEW public.v_matter_aging AS
WITH base AS (
  SELECT
    'matter'::text AS entity,
    m.id::text AS id,
    COALESCE(
      NULLIF(trim(m.name), ''),
      NULLIF(trim(concat_ws(' ', ci.first_name, ci.last_name)), '')
    ) AS client_name,
    ci.email AS client_email,
    ci.phone AS client_phone,
    COALESCE(NULLIF(m.track, ''), 'DEFAULT') AS track,
    public.map_matter_stage_to_engine(m.stage) AS current_stage,
    s.stage_order,
    s.owner,
    COALESCE(m.stage_entered_at, m.created_at) AS stage_entered_at,
    public.business_days_elapsed(COALESCE(m.stage_entered_at, m.created_at)) AS days_in_stage,
    s.sla_days,
    s.escalation_offset,
    (s.sla_days IS NOT NULL
       AND public.business_days_elapsed(COALESCE(m.stage_entered_at, m.created_at)) > s.sla_days) AS is_overdue,
    (s.escalation_offset IS NOT NULL
       AND public.business_days_elapsed(COALESCE(m.stage_entered_at, m.created_at)) >= s.escalation_offset) AS needs_outreach,
    CASE
      WHEN s.sla_days IS NULL THEN 'green'
      WHEN public.business_days_elapsed(COALESCE(m.stage_entered_at, m.created_at)) > s.sla_days THEN 'red'
      WHEN s.escalation_offset IS NOT NULL
           AND public.business_days_elapsed(COALESCE(m.stage_entered_at, m.created_at)) >= s.escalation_offset THEN 'red'
      WHEN public.business_days_elapsed(COALESCE(m.stage_entered_at, m.created_at)) >= (s.sla_days - 1) THEN 'amber'
      ELSE 'green'
    END AS raw_health,
    CASE WHEN s.sla_days IS NULL THEN NULL
         ELSE public.business_days_elapsed(COALESCE(m.stage_entered_at, m.created_at)) - s.sla_days
    END AS days_over_sla
  FROM public.matters m
  LEFT JOIN public.client_intake ci ON ci.id = m.client_intake_id
  JOIN public.stage_sla s
    ON s.stage_key = public.map_matter_stage_to_engine(m.stage)
   AND s.track = COALESCE(NULLIF(m.track, ''), 'DEFAULT')
   AND s.entity = 'matter'
  WHERE m.status = 'active'
    AND public.map_matter_stage_to_engine(m.stage) IS NOT NULL
    AND public.map_matter_stage_to_engine(m.stage) <> 'matter_closed'
)
SELECT
  b.entity,
  b.id,
  b.client_name,
  b.client_email,
  b.client_phone,
  b.track,
  b.current_stage,
  b.stage_order,
  b.owner,
  b.stage_entered_at,
  b.days_in_stage,
  b.sla_days,
  b.escalation_offset,
  CASE WHEN sn.id IS NOT NULL THEN false ELSE b.is_overdue END AS is_overdue,
  CASE WHEN sn.id IS NOT NULL THEN false ELSE b.needs_outreach END AS needs_outreach,
  CASE WHEN sn.id IS NOT NULL THEN 'green'::text ELSE b.raw_health END AS health,
  b.raw_health,
  b.days_over_sla,
  sn.id AS snooze_id,
  sn.snoozed_until,
  sn.reason AS snooze_reason,
  (sn.id IS NOT NULL) AS is_snoozed
FROM base b
LEFT JOIN public.pipeline_aging_snooze sn
  ON sn.entity = 'matter'
 AND sn.entity_id = b.id
 AND sn.stage_key = b.current_stage
 AND sn.snoozed_until > now();

ALTER VIEW public.v_matter_aging SET (security_invoker = true);

GRANT SELECT ON public.v_matter_aging TO service_role;
GRANT SELECT ON public.v_matter_aging TO authenticated;
