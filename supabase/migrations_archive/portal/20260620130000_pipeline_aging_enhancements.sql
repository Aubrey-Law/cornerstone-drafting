-- Pipeline aging enhancements: contact fields, snooze table, updated view.

CREATE TABLE IF NOT EXISTS public.pipeline_aging_snooze (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity text NOT NULL CHECK (entity IN ('lead', 'matter')),
  entity_id text NOT NULL,
  stage_key text NOT NULL,
  stage_entered_at timestamptz NOT NULL,
  snoozed_until timestamptz NOT NULL,
  reason text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity, entity_id, stage_key, stage_entered_at)
);

CREATE INDEX IF NOT EXISTS idx_pipeline_aging_snooze_active
  ON public.pipeline_aging_snooze (entity, entity_id, snoozed_until DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pipeline_aging_snooze TO service_role;

-- Postgres cannot insert/rename view columns via CREATE OR REPLACE; drop dependents first.
DROP VIEW IF EXISTS public.v_matter_aging;
DROP VIEW IF EXISTS public.v_nudges_due;
DROP VIEW IF EXISTS public.v_pipeline_aging;

CREATE VIEW public.v_pipeline_aging AS
WITH unified AS (
  SELECT
    'lead'::text AS entity,
    l.id::text AS id,
    l.client_name,
    l.email AS client_email,
    l.phone AS client_phone,
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
    ci.email AS client_email,
    ci.phone AS client_phone,
    m.track,
    public.map_matter_stage_to_engine_stage(m.stage) AS current_stage,
    COALESCE(m.stage_entered_at, m.created_at) AS stage_entered_at
  FROM public.matters m
  LEFT JOIN public.client_intake ci ON ci.id = m.client_intake_id
  WHERE m.status = 'active'
    AND public.map_matter_stage_to_engine_stage(m.stage) IS NOT NULL
    AND public.map_matter_stage_to_engine_stage(m.stage) <> 'matter_closed'
),
base AS (
  SELECT
    u.entity,
    u.id,
    u.client_name,
    u.client_email,
    u.client_phone,
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
    END AS raw_health,
    CASE WHEN s.sla_days IS NULL THEN NULL
         ELSE public.business_days_elapsed(u.stage_entered_at) - s.sla_days
    END AS days_over_sla
  FROM unified u
  JOIN public.stage_sla s
    ON s.stage_key = u.current_stage
   AND s.track = u.track
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
  ON sn.entity = b.entity
 AND sn.entity_id = b.id
 AND sn.stage_key = b.current_stage
 AND sn.stage_entered_at = b.stage_entered_at
 AND sn.snoozed_until > now();

CREATE VIEW public.v_matter_aging AS
  SELECT * FROM public.v_pipeline_aging WHERE entity = 'matter';

CREATE VIEW public.v_nudges_due AS
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

GRANT SELECT ON public.v_pipeline_aging TO service_role;
GRANT SELECT ON public.v_matter_aging TO service_role;
GRANT SELECT ON public.v_nudges_due TO service_role;
