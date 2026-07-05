-- Cornerstone Drafting — pipeline view, activity, auth hook (part 3 of 3)

CREATE TABLE IF NOT EXISTS public.matter_stage_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_stage  text NOT NULL,
  to_stage    text NOT NULL,
  rule_key    text NOT NULL,
  description text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.matter_stage_rules (from_stage, to_stage, rule_key, description)
SELECT 'drafting', 'client_review', 'drafts_ready', 'Drafts generated and ready for review'
WHERE NOT EXISTS (
  SELECT 1 FROM public.matter_stage_rules WHERE rule_key = 'drafts_ready'
);

ALTER TABLE public.matter_stage_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "attorneys_read_stage_rules"
  ON public.matter_stage_rules FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin')));

-- Drafting hub view (no CRM appointments dependency)
DROP VIEW IF EXISTS public.v_matter_pipeline CASCADE;

CREATE VIEW public.v_matter_pipeline AS
SELECT
  m.id            AS matter_id,
  m.name          AS matter_name,
  m.stage,
  m.status,
  m.flags,
  m.created_at    AS matter_created,
  trim(concat_ws(' ', ci.first_name, ci.last_name)) AS client_name,
  ci.email        AS client_email,
  ci.phone        AS client_phone,
  ci.date_of_birth AS client_dob,
  NULLIF(
    concat_ws(', ',
      NULLIF(trim(concat_ws(' ', ci.address_line1, ci.address_line2)), ''),
      NULLIF(ci.city, ''),
      NULLIF(trim(concat_ws(' ', ci.state, ci.zip)), '')
    ),
    ''
  )               AS client_address,
  NULLIF(trim(concat_ws(' ', cs.first_name, cs.last_name)), '') AS spouse_name,
  cs.email        AS spouse_email,
  cs.phone        AS spouse_phone,
  cs.date_of_birth AS spouse_dob,
  NULLIF(
    concat_ws(', ',
      NULLIF(trim(concat_ws(' ', ci.address_line1, ci.address_line2)), ''),
      NULLIF(ci.city, ''),
      NULLIF(trim(concat_ws(' ', ci.state, ci.zip)), '')
    ),
    ''
  )               AS spouse_address,
  ci.plan_type,
  ci.marital_status,
  ci.has_minor_children,
  ci.taxable_estate,
  ci.status       AS intake_status,
  ci.intake_sent_at,
  ds.status       AS design_status,
  m.intake_submitted_at,
  m.drafts_sent_at,
  m.signing_date,
  m.documents_executed_at,
  NULL::timestamptz AS next_appointment,
  NULL::text        AS next_appointment_type,
  md.practice_area,
  md.referral_source,
  md.flat_fee_amount AS fee_amount,
  md.open_date::timestamptz AS opened_at,
  md.client_status
FROM public.matters m
JOIN public.client_intake ci ON ci.id = m.client_intake_id
LEFT JOIN public.contacts cs ON cs.client_intake_id = ci.id AND cs.relationship_type = 'spouse'
LEFT JOIN public.design_sheets ds ON ds.matter_id = m.id
LEFT JOIN public.matter_details md ON md.client_id = m.id
WHERE m.status <> 'archived';

ALTER VIEW public.v_matter_pipeline SET (security_invoker = true);

CREATE POLICY "client_read_visible_matter_documents"
  ON public.matter_documents
  FOR SELECT TO authenticated
  USING (
    lower(coalesce(folder, '')) NOT IN ('draft', 'drafts')
    AND (
      folder_id IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM public.folders f
        WHERE f.id = matter_documents.folder_id
          AND lower(f.name) IN ('draft', 'drafts')
      )
    )
    AND (
      EXISTS (
        SELECT 1 FROM public.matters m
        WHERE m.id::text = matter_documents.matter_id AND m.client_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.v_matter_pipeline v
        WHERE v.matter_id::text = matter_documents.matter_id
          AND v.client_email = (SELECT email FROM auth.users WHERE id = auth.uid())
      )
    )
  );

-- ── Matter activity ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.matter_activity (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id   text NOT NULL,
  event_type  text NOT NULL,
  actor_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email text,
  actor_name  text,
  title       text NOT NULL,
  detail      text,
  metadata    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT matter_activity_event_type_check CHECK (
    event_type IN (
      'stage_changed', 'note_added', 'document_uploaded', 'document_viewed',
      'document_downloaded', 'task_created', 'task_completed', 'flag_added', 'flag_removed',
      'alert_created', 'alert_resolved', 'intake_sent', 'intake_completed',
      'email_sent', 'draft_generated', 'draft_promoted_to_review',
      'matter_created', 'matter_archived', 'status_changed'
    )
  )
);

CREATE INDEX IF NOT EXISTS matter_activity_matter_id_idx ON public.matter_activity(matter_id);
CREATE INDEX IF NOT EXISTS matter_activity_created_at_idx ON public.matter_activity(matter_id, created_at DESC);

ALTER TABLE public.matter_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_select_matter_activity"
  ON public.matter_activity FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "authenticated_insert_matter_activity"
  ON public.matter_activity FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- ── AI usage telemetry ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ai_usage (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  user_id                     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  route                       text NOT NULL,
  context_type                text,
  matter_id                   uuid REFERENCES public.matters(id) ON DELETE SET NULL,
  model                       text NOT NULL,
  input_tokens                integer NOT NULL DEFAULT 0,
  output_tokens               integer NOT NULL DEFAULT 0,
  cache_read_input_tokens     integer NOT NULL DEFAULT 0,
  cache_creation_input_tokens integer NOT NULL DEFAULT 0,
  duration_ms                 integer,
  success                     boolean NOT NULL DEFAULT true,
  error_message               text
);

CREATE INDEX IF NOT EXISTS ai_usage_created_at_idx ON public.ai_usage(created_at DESC);

ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_usage_admin_read"
  ON public.ai_usage FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('attorney', 'admin'))
  );

-- ── JWT custom claims hook ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  claims jsonb;
  resolved_role text;
BEGIN
  claims := event->'claims';

  SELECT u.role INTO resolved_role
  FROM public.users u
  WHERE u.id = (event->>'user_id')::uuid;

  IF resolved_role IS NOT NULL THEN
    claims := jsonb_set(claims, '{user_role}', to_jsonb(resolved_role));
  END IF;

  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated, anon, public;

-- ── Storage bucket for Supabase template engine ───────────────────────────────
-- Run manually in Supabase dashboard or via CLI if not present:
--   insert into storage.buckets (id, name, public) values ('templates', 'templates', false);
