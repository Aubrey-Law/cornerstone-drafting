-- =============================================================================
-- Design sheet + drafting: consolidated schema
-- =============================================================================
-- Generated from Cornerstone's full migration history (312 migrations applied
-- to a clean Supabase Postgres 17), then filtered to the objects the drafting
-- bundle reads or writes. One file, in dependency order, for a new Supabase
-- project. Turn it into a migration in the new app's own format.
--
-- Sections:
--   1. HOST CONTRACT tables: users, client_intake, matters, matter_details,
--      contacts, contact_roles, matter_contacts, and the v_matter_pipeline view.
--      These are Cornerstone's real definitions. The new app almost certainly
--      has its own equivalents; map the columns drafting reads (README,
--      "Host contract") onto them instead of creating these verbatim.
--   2. FEATURE tables: design_sheets, doc_selections, draft_log,
--      draft_generation_runs, matter_documents (+ folders), document_versions,
--      style_sets, custom_document_templates, document_template_* (versions,
--      publications, events), the eight estate-clause tables.
--   3. SUPPORT tables: ai_usage, user_api_keys, rate_limits,
--      document_access_audit.
--   4. Functions/RPCs (27), triggers, RLS policies and grants for the above.
--
-- Left out on purpose (Cornerstone-only; see README "Seams"):
--   * triggers that call host functions: CRM sync, lead/stage stamping, SLA
--     prompts (trg_design_sheets_fire_field_prompts*), billing seeding,
--     contacts <-> matter_contacts dual-write sync, and
--     seed_estate_planning_document_folders (which created each matter's
--     "Drafts" folder; without it, file_generated_draft_into_drafts_folder
--     simply leaves folder_id null);
--   * FKs to host tables not exported (ai_usage.workflow_run_id,
--     client_intake.form_version_id) - the columns remain, unconstrained.
--
-- Requires the Supabase roles (anon, authenticated, service_role), the auth
-- schema (auth.users, auth.uid(), auth.jwt()) and Storage. Postgres 15+.
-- =============================================================================

SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET client_min_messages = warning;

--
-- Name: cancel_document_template_version(text, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_document_template_version(p_template_id text, p_version_id uuid, p_actor_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_version public.document_template_versions%ROWTYPE;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_template_id, 0));

  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_actor_id AND u.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Administrator role required';
  END IF;

  SELECT * INTO v_version
  FROM public.document_template_versions v
  WHERE v.id = p_version_id AND v.template_id = p_template_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Template version not found'; END IF;
  IF v_version.validation_status = 'canceled' THEN
    RAISE EXCEPTION 'Template version is already canceled';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.document_template_publications p
    WHERE p.template_id = p_template_id AND p.version_id = p_version_id
  ) THEN
    RAISE EXCEPTION 'The active template version cannot be canceled';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.document_template_events e
    WHERE e.template_id = p_template_id
      AND e.version_id = p_version_id
      AND e.event_type IN ('published', 'rolled_back')
  ) THEN
    RAISE EXCEPTION 'A previously published template version cannot be canceled';
  END IF;

  UPDATE public.document_template_versions
  SET validation_status = 'canceled',
      canceled_at = now(),
      canceled_by = p_actor_id
  WHERE id = p_version_id;

  INSERT INTO public.document_template_events (
    template_id, version_id, event_type, actor_id, metadata
  ) VALUES (
    p_template_id,
    p_version_id,
    'canceled',
    p_actor_id,
    jsonb_build_object(
      'filename', v_version.original_filename,
      'storagePath', v_version.storage_path,
      'sha256', v_version.sha256
    )
  );

  RETURN jsonb_build_object(
    'templateId', p_template_id,
    'versionId', p_version_id,
    'storagePath', v_version.storage_path
  );
END;
$$;


--
-- Name: claim_draft_generation_run(uuid, uuid, uuid, text, text, text[], uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_draft_generation_run(p_id uuid, p_matter_id uuid, p_actor_id uuid, p_revision text, p_request_hash text, p_documents text[], p_worker_token uuid) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare r public.draft_generation_runs;
begin
  -- One lock per matter prevents two different request IDs running together.
  perform pg_advisory_xact_lock(hashtextextended(p_matter_id::text, 0));
  select * into r from public.draft_generation_runs where id = p_id for update;
  if found then
    if r.matter_id <> p_matter_id or r.request_hash <> p_request_hash then
      raise exception 'Run request does not match its original source and documents';
    end if;
    if r.status = 'completed' or (r.status = 'running' and r.lease_expires_at > now()) then
      return to_jsonb(r);
    end if;
  end if;
  if exists(select 1 from public.draft_generation_runs where matter_id = p_matter_id and status = 'running' and lease_expires_at > now() and id <> p_id) then
    raise exception 'Another draft run is active for this matter. Open its status before starting another.';
  end if;
  -- Expired workers are fenced by the document trigger below and cannot register output.
  update public.draft_generation_runs set status = 'failed', error = 'Run interrupted. Check saved documents and retry.', updated_at = now()
    where matter_id = p_matter_id and status = 'running' and lease_expires_at <= now();
  insert into public.draft_generation_runs(id, matter_id, created_by, source_revision, request_hash, requested_documents, status, worker_token, lease_expires_at)
    values(p_id, p_matter_id, p_actor_id, p_revision, p_request_hash, p_documents, 'running', p_worker_token, now() + interval '6 minutes')
  on conflict(id) do update set status = 'running', worker_token = excluded.worker_token, lease_expires_at = excluded.lease_expires_at, error = null, updated_at = now()
  returning * into r;
  return to_jsonb(r);
end $$;


--
-- Name: matters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.matters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_intake_id uuid NOT NULL,
    client_id uuid,
    name text DEFAULT ''::text NOT NULL,
    matter_number text,
    stage text DEFAULT 'drafting'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    flags text[] DEFAULT '{}'::text[],
    intake_submitted_at timestamp with time zone,
    drafts_sent_at timestamp with time zone,
    signing_date timestamp with time zone,
    documents_executed_at timestamp with time zone,
    li_plan_coverage text,
    li_design_sheet_data jsonb,
    li_design_sheet_approved boolean,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    unread_client_messages integer DEFAULT 0 NOT NULL,
    unread_attorney_messages integer DEFAULT 0 NOT NULL,
    stage_entered_at timestamp with time zone DEFAULT now(),
    track text DEFAULT 'DEFAULT'::text NOT NULL,
    review_responded_at timestamp with time zone,
    design_meeting_at timestamp with time zone,
    revision_round integer DEFAULT 0 NOT NULL,
    portal_uploads_reviewed_at timestamp with time zone,
    matter_number_manual boolean DEFAULT false NOT NULL,
    relationship_status text DEFAULT 'hired'::text NOT NULL,
    hired_at timestamp with time zone,
    lost_at timestamp with time zone,
    lost_reason text,
    creation_request_id uuid,
    declined_at timestamp with time zone,
    declined_reason text,
    closed_at timestamp with time zone,
    on_hold_at timestamp with time zone,
    hold_reason text,
    discovery_call_at timestamp with time zone,
    fit_decision text,
    fit_decided_at timestamp with time zone,
    pmps_at timestamp with time zone,
    recommendations_sent_at timestamp with time zone,
    engagement_signed_at timestamp with time zone,
    matter_type text,
    imported_at timestamp with time zone,
    merged_into_id uuid,
    merged_at timestamp with time zone,
    CONSTRAINT matters_fit_decision_check CHECK (((fit_decision IS NULL) OR (fit_decision = ANY (ARRAY['fit'::text, 'not_a_fit'::text])))),
    CONSTRAINT matters_matter_type_check CHECK (((matter_type IS NULL) OR (matter_type = ANY (ARRAY['individual'::text, 'couple'::text])))),
    CONSTRAINT matters_relationship_status_check CHECK ((relationship_status = ANY (ARRAY['lead'::text, 'hired'::text, 'lost'::text, 'declined'::text]))),
    CONSTRAINT matters_stage_check CHECK (((stage IS NULL) OR (stage = ANY (ARRAY['new_lead'::text, 'discovery_call'::text, 'intake_sent'::text, 'intake_completed'::text, 'engagement_sent'::text, 'intake'::text, 'intake_review'::text, 'design'::text, 'drafting'::text, 'client_review'::text, 'revision'::text, 'drafts_approved'::text, 'signing_scheduled'::text, 'signing_complete'::text, 'post_execution'::text, 'funding'::text, 'closed'::text])))),
    CONSTRAINT matters_status_check CHECK ((status = ANY (ARRAY['active'::text, 'on_hold'::text, 'closed'::text, 'archived'::text])))
);


--
-- Name: COLUMN matters.portal_uploads_reviewed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.matters.portal_uploads_reviewed_at IS 'When staff last reviewed client portal uploads; uploads after this timestamp are unreviewed.';


--
-- Name: COLUMN matters.creation_request_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.matters.creation_request_id IS 'Caller-supplied idempotency key for matter creation. One matter per key.';


--
-- Name: COLUMN matters.matter_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.matters.matter_type IS 'Attorney-confirmed participant composition: individual or couple. Independent of marital status.';


--
-- Name: COLUMN matters.imported_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.matters.imported_at IS 'When this matter was brought into Cornerstone from outside it (POST /api/admin/matters/import). Null for matters created through the normal workflow.';


--
-- Name: COLUMN matters.merged_into_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.matters.merged_into_id IS 'Set when this lead or matter was merged into another. The row is archived rather than deleted, so whatever could not move stays readable and old links can follow it to the matter it became.';


--
-- Name: delete_matter_contact(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_matter_contact(p_contact_id uuid, p_matter_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
DECLARE
  detached_count integer;
  remaining_count integer;
BEGIN
  -- Appointments belong to the matter, so only this matter's are cleared.
  DELETE FROM public.contact_roles
  WHERE contact_id = p_contact_id
    AND matter_id = p_matter_id;

  DELETE FROM public.matter_contacts
  WHERE contact_id = p_contact_id
    AND matter_id = p_matter_id;

  GET DIAGNOSTICS detached_count = ROW_COUNT;
  IF detached_count = 0 THEN
    RETURN 0;
  END IF;

  SELECT count(*) INTO remaining_count
  FROM public.matter_contacts
  WHERE contact_id = p_contact_id;

  -- Still on another matter: the person stays, they are simply no longer on
  -- this one. Only a person left on no matter at all is deleted, and then only
  -- if they are not a standalone directory entry.
  IF remaining_count = 0 THEN
    DELETE FROM public.contact_roles WHERE contact_id = p_contact_id;
    DELETE FROM public.contacts
    WHERE id = p_contact_id
      AND client_intake_id IS NOT NULL;
  END IF;

  RETURN detached_count;
END;
$$;


--
-- Name: FUNCTION delete_matter_contact(p_contact_id uuid, p_matter_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.delete_matter_contact(p_contact_id uuid, p_matter_id uuid) IS 'Remove a person from one matter. Deletes the contacts row only when no matter still references them. Replaces delete_intake_contact, which deleted the person outright and so would have removed them from every matter at once.';


--
-- Name: draft_generation_metrics(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.draft_generation_metrics(p_matter_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  select jsonb_build_object(
    'runs', count(*),
    'completed', count(*) filter(where status = 'completed'),
    'needsAttention', count(*) filter(where status in ('failed','partial') or (status='running' and lease_expires_at <= now())),
    'averageRunSeconds', avg(extract(epoch from updated_at-created_at)) filter(where status='completed'),
    'reviewedDocuments', (select count(*) from public.matter_documents d where d.matter_id=p_matter_id::text and d.generation_id is not null and d.created_at >= now()-interval '30 days' and d.reviewed_at is not null and d.superseded_at is null),
    'averageReviewSeconds', (select avg(greatest(0,extract(epoch from d.reviewed_at-d.created_at))) from public.matter_documents d where d.matter_id=p_matter_id::text and d.generation_id is not null and d.created_at >= now()-interval '30 days' and d.reviewed_at is not null and d.superseded_at is null)
  ) from public.draft_generation_runs where matter_id=p_matter_id and created_at >= now()-interval '30 days';
$$;


--
-- Name: drafting_hub_draft_rollups(text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.drafting_hub_draft_rollups(p_matter_ids text[]) RETURNS TABLE(matter_id text, current_draft_count integer, superseded_draft_count integer, recent_drafts jsonb)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH docs AS (
    SELECT
      d.matter_id,
      d.id,
      d.name,
      d.size,
      d.created_at,
      d.generation_id,
      d.generation_engine,
      d.marker_count,
      d.missing_count,
      d.superseded_at,
      d.reviewed_at,
      d.reviewed_by
    FROM public.matter_documents d
    WHERE d.source = 'firm'
      AND d.matter_id = ANY (p_matter_ids)
  ),
  counts AS (
    SELECT
      docs.matter_id,
      COUNT(*) FILTER (WHERE docs.superseded_at IS NULL)::integer AS current_draft_count,
      COUNT(*) FILTER (WHERE docs.superseded_at IS NOT NULL)::integer AS superseded_draft_count
    FROM docs
    GROUP BY docs.matter_id
  ),
  current_ranked AS (
    SELECT
      docs.*,
      ROW_NUMBER() OVER (
        PARTITION BY docs.matter_id
        ORDER BY docs.created_at DESC
      ) AS row_num
    FROM docs
    WHERE docs.superseded_at IS NULL
  ),
  recent AS (
    SELECT
      current_ranked.matter_id,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', current_ranked.id,
            'name', current_ranked.name,
            'size', current_ranked.size,
            'created_at', current_ranked.created_at,
            'generationId', current_ranked.generation_id,
            'generationEngine', current_ranked.generation_engine,
            'markerCount', current_ranked.marker_count,
            'missingCount', current_ranked.missing_count,
            'supersededAt', current_ranked.superseded_at,
            'reviewedAt', current_ranked.reviewed_at,
            'reviewedBy', current_ranked.reviewed_by
          )
          ORDER BY current_ranked.created_at DESC
        ),
        '[]'::jsonb
      ) AS recent_drafts
    FROM current_ranked
    WHERE current_ranked.row_num <= 5
    GROUP BY current_ranked.matter_id
  )
  SELECT
    counts.matter_id,
    counts.current_draft_count,
    counts.superseded_draft_count,
    COALESCE(recent.recent_drafts, '[]'::jsonb) AS recent_drafts
  FROM counts
  LEFT JOIN recent ON recent.matter_id = counts.matter_id;
$$;


--
-- Name: drafting_hub_has_documents(text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.drafting_hub_has_documents(p_plan text, p_decisions jsonb) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  with defaults as (
    select coalesce(btrim(p_decisions->>'plan_track') = 'college_prep', false) as college
  ), inclusions as (
    select jsonb_build_object(
      'trust', not college and coalesce(btrim(p_plan) not in ('outright_will', 'testamentary_trust'), true),
      'will', not college or coalesce(p_decisions#>'{college_prep,will_include}' = 'true'::jsonb, false),
      'dpoa', true, 'healthcare', true, 'deed', false, 'young_adult_estate_plan', false,
      'ferpa_release', college and coalesce(p_decisions#>'{college_prep,ferpa_release}' = 'true'::jsonb, false),
      'education_poa', college, 'spouse_docs', false
    ) as value from defaults
  )
  select exists (
    select 1 from inclusions, jsonb_each(inclusions.value) as d(key, value)
    where case when jsonb_typeof(p_decisions->'document_inclusions'->d.key) = 'boolean'
      then (p_decisions->'document_inclusions'->>d.key)::boolean
      else d.value = 'true'::jsonb end
  );
$$;


--
-- Name: drafting_hub_page(text, text, text, text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.drafting_hub_page(p_search text DEFAULT ''::text, p_action text DEFAULT 'all'::text, p_practice text DEFAULT 'all'::text, p_sort text DEFAULT 'updated'::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 50) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  with settings as (
    select greatest(1, least(coalesce(p_page_size, 50), 50)) as page_size,
      greatest(1, coalesce(p_page, 1)) as requested_page
  ), pipeline as materialized (
    -- A legacy intake with multiple spouse contacts must still be one matter.
    select distinct on (v.matter_id) v.* from public.v_matter_pipeline v
    where v.stage in ('design', 'drafting', 'client_review', 'drafts_approved', 'revision')
      and coalesce(v.status, '') not in ('closed', 'archived')
    order by v.matter_id, v.spouse_name nulls last, v.spouse_email nulls last
  ), base as materialized (
    select v.matter_id, to_jsonb(v) as matter, m.matter_number,
      nullif(btrim(v.practice_area), '') as practice_area, lower(coalesce(v.client_name, '')) as client_sort,
      ds.sheet, ds.sheet_id,
      coalesce(d.current_count, 0) as current_count, coalesce(d.superseded_count, 0) as superseded_count,
      coalesce(d.latest_draft, ds.updated_at, v.matter_created) as activity_at,
      case when v.stage = 'revision' then 'revise'
        when v.stage in ('client_review', 'drafts_approved') then 'review'
        when ds.sheet_id is null then 'design'
        -- Lite's getDraftSetupBlockers currently returns no setup field gates.
        when not public.drafting_hub_has_documents(ds.plan_type, ds.decisions) then 'setup'
        when coalesce(d.current_count, 0) = 0 then 'generate'
        else 'review' end as action,
      lower(concat_ws(' ', m.matter_number, v.matter_id, v.client_name, v.spouse_name,
        v.matter_name, v.client_email, v.plan_type, v.practice_area, v.stage)) as haystack
    from pipeline v join public.matters m on m.id = v.matter_id
    left join lateral (
      select s.id as sheet_id, s.plan_type, s.decisions, coalesce(s.updated_at, s.created_at) as updated_at,
        jsonb_build_object('id', s.id, 'matter_id', s.matter_id, 'status', s.status,
          'version', s.version, 'plan_type', s.plan_type, 'decisions', s.decisions,
          'created_at', s.created_at, 'updated_at', s.updated_at) as sheet
      from public.design_sheets s where s.matter_id = v.matter_id
      order by s.created_at desc, s.id desc limit 1
    ) ds on true
    left join lateral (
      select count(*) filter (where doc.superseded_at is null) as current_count,
        count(*) filter (where doc.superseded_at is not null) as superseded_count,
        max(doc.created_at) filter (where doc.superseded_at is null) as latest_draft
      from public.matter_documents doc where doc.matter_id = v.matter_id::text and doc.source = 'firm'
    ) d on true
  ), searched as materialized (
    select *, coalesce(activity_at <= now() - interval '10 days', false) as quiet
    from base where not exists (
      select 1 from regexp_split_to_table(lower(btrim(left(coalesce(p_search, ''), 300))), '\s+') token
      where token <> '' and strpos(base.haystack, token) = 0
    )
  ), practice_filtered as materialized (
    select * from searched where coalesce(p_practice, 'all') = 'all' or practice_area = p_practice
  ), action_filtered as materialized (
    select * from searched where coalesce(p_action, 'all') = 'all' or action = p_action or (p_action = 'quiet' and quiet)
  ), filtered as materialized (
    select * from practice_filtered where coalesce(p_action, 'all') = 'all' or action = p_action or (p_action = 'quiet' and quiet)
  ), totals as (
    select count(*) as total from filtered
  ), bounds as (
    select total, page_size, least(requested_page, greatest(1, ceil(total::numeric / page_size)::integer)) as page
    from totals cross join settings
  ), ordered as (
    select *, row_number() over (order by
      case when p_sort = 'client' then client_sort end collate "C" asc,
      case when p_sort = 'action' then case action when 'design' then 0 when 'setup' then 1 when 'generate' then 2 when 'review' then 3 else 4 end end asc,
      activity_at desc nulls last, matter_id asc) as position
    from filtered
  ), page_rows as materialized (
    select ordered.* from ordered cross join bounds
    where position > (bounds.page::bigint - 1) * bounds.page_size
      and position <= bounds.page::bigint * bounds.page_size
  ), hydrated as (
    select p.position, jsonb_build_object('matter', p.matter, 'matterNumber', p.matter_number,
      'sheet', p.sheet, 'currentDraftCount', p.current_count, 'supersededDraftCount', p.superseded_count,
      'selections', coalesce((select jsonb_agg(jsonb_build_object('design_sheet_id', sel.design_sheet_id,
        'doc_type', sel.doc_type, 'variant', sel.variant, 'party', sel.party, 'selected', sel.selected)
        order by sel.doc_type, sel.variant, sel.party)
        from public.doc_selections sel where sel.design_sheet_id = p.sheet_id and sel.selected = true), '[]'::jsonb),
      'recentDrafts', coalesce((select jsonb_agg(jsonb_build_object('id', doc.id, 'name', doc.name,
        'r2_key', doc.r2_key, 'current_version_id', doc.current_version_id,
        'size', doc.size, 'created_at', doc.created_at, 'generationId', doc.generation_id,
        'generationEngine', doc.generation_engine, 'markerCount', doc.marker_count,
        'missingCount', doc.missing_count, 'supersededAt', doc.superseded_at,
        'reviewedAt', doc.reviewed_at, 'reviewedBy', doc.reviewed_by) order by doc.created_at desc, doc.id desc)
        from (select d.* from public.matter_documents d where d.matter_id = p.matter_id::text
          and d.source = 'firm' and d.superseded_at is null order by d.created_at desc, d.id desc limit 5) doc), '[]'::jsonb)
    ) as row from page_rows p
  )
  select jsonb_build_object('rows', coalesce((select jsonb_agg(row order by position) from hydrated), '[]'::jsonb),
    'total', bounds.total, 'page', bounds.page, 'pageSize', bounds.page_size,
    'actionCounts', (select jsonb_build_object('all', count(*),
      'design', count(*) filter (where action = 'design'), 'setup', count(*) filter (where action = 'setup'),
      'generate', count(*) filter (where action = 'generate'), 'review', count(*) filter (where action = 'review'),
      'revise', count(*) filter (where action = 'revise'), 'quiet', count(*) filter (where quiet)) from practice_filtered),
    'practiceCounts', coalesce((select jsonb_agg(jsonb_build_object('name', practice_area, 'count', n) order by practice_area)
      from (select practice_area, count(*) as n from action_filtered where practice_area is not null group by practice_area) areas), '[]'::jsonb))
  from bounds;
$$;


--
-- Name: ensure_user_profile(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ensure_user_profile(p_display_name text DEFAULT NULL::text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_email        text;
  v_role         text;
  v_existing     text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'ensure_user_profile requires an authenticated session';
  END IF;

  SELECT u.role INTO v_existing FROM public.users u WHERE u.id = v_uid;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- Prefer the confirmed address on auth.users over any JWT claim.
  SELECT au.email INTO v_email FROM auth.users au WHERE au.id = v_uid;

  v_role := CASE
    WHEN v_email IS NOT NULL AND lower(v_email) LIKE '%@aubreylegal.com' THEN 'attorney'
    ELSE 'client'
  END;

  INSERT INTO public.users (id, email, display_name, role)
  VALUES (v_uid, v_email, nullif(btrim(coalesce(p_display_name, '')), ''), v_role)
  ON CONFLICT (id) DO NOTHING;

  SELECT u.role INTO v_existing FROM public.users u WHERE u.id = v_uid;
  RETURN coalesce(v_existing, v_role);
END;
$$;


--
-- Name: file_generated_draft_into_drafts_folder(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.file_generated_draft_into_drafts_folder() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.generation_id IS NULL
     OR NEW.folder_id IS NOT NULL
     OR NEW.source = 'client'
     OR NEW.name ~* '\m(signed|executed|notariz\w*|conformed)\M' THEN
    RETURN NEW;
  END IF;

  SELECT f.id INTO NEW.folder_id
  FROM public.matter_document_folders f
  WHERE f.matter_id::text = NEW.matter_id
    AND f.parent_id IS NULL
    AND lower(btrim(f.name)) = 'drafts'
  LIMIT 1;

  RETURN NEW;
END;
$$;


--
-- Name: guard_draft_run_output(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_draft_run_output() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare r public.draft_generation_runs;
begin
  if new.r2_key like 'matters/%/draft-runs/%' then
    new.draft_run_output := split_part(new.r2_key, '/', 6);
    -- Key: matters/<matter>/draft-runs/<run>/<worker>/<filename>.
    select * into r from public.draft_generation_runs where id = new.generation_id for update;
    if not found or r.matter_id::text <> new.matter_id or r.status <> 'running' or r.lease_expires_at <= now()
      or split_part(new.r2_key, '/', 4) <> r.id::text
      or split_part(new.r2_key, '/', 5) <> r.worker_token::text then
      raise exception 'Draft execution lease expired; output was not registered';
    end if;
  end if;
  return new;
end $$;


--
-- Name: is_contact_channel_list(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_contact_channel_list(value jsonb) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select
    jsonb_typeof(value) = 'array'
    and jsonb_array_length(value) <= 6
    and not exists (
      select 1
      from jsonb_array_elements(value) as entry
      where jsonb_typeof(entry) <> 'object'
        or jsonb_typeof(entry -> 'value') <> 'string'
        or coalesce(entry ->> 'value', '') = ''
        or (entry ? 'label' and jsonb_typeof(entry -> 'label') <> 'string')
    );
$$;


--
-- Name: FUNCTION is_contact_channel_list(value jsonb); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.is_contact_channel_list(value jsonb) IS 'True when the value is an array (max 6) of {label?: string, value: string} objects with a non-empty value.';


--
-- Name: load_estate_clause_generation_snapshot(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.load_estate_clause_generation_snapshot(p_matter_id uuid) RETURNS jsonb
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  WITH publications AS MATERIALIZED (
    SELECT p.clause_id, p.current_revision_id, c.clause_key, c.title,
           c.jurisdiction, c.document_types, r.revision_number, r.clause_text,
           r.required_fields, r.nested_clause_keys, r.condition_field, r.content_hash
    FROM public.estate_clause_publications p
    JOIN public.estate_clauses c ON c.id = p.clause_id AND c.is_active
    JOIN public.estate_clause_revisions r
      ON r.id = p.current_revision_id AND r.clause_id = p.clause_id
  ), latest_override AS MATERIALIZED (
    SELECT DISTINCT ON (o.clause_id) o.*
    FROM public.matter_estate_clause_overrides o
    WHERE o.matter_id = p_matter_id
    ORDER BY o.clause_id, o.created_at DESC, o.id DESC
  )
  SELECT jsonb_build_object(
    'publications', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.clause_key) FROM publications p), '[]'::jsonb),
    'overrides', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', o.id, 'clause_id', o.clause_id, 'clause_key', p.clause_key,
        'publication_revision_id', o.publication_revision_id, 'action', o.action,
        'reason', o.reason, 'created_by', o.created_by, 'created_at', o.created_at
      ) ORDER BY p.clause_key)
      FROM latest_override o JOIN publications p ON p.clause_id = o.clause_id
      WHERE o.event_type = 'applied' AND o.publication_revision_id = p.current_revision_id
    ), '[]'::jsonb)
  );
$$;


--
-- Name: lock_estate_clause_publication_changes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.lock_estate_clause_publication_changes() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('estate-clause-publications', 0)
  );
  RETURN NULL;
END;
$$;


--
-- Name: lock_estate_template_publication_changes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.lock_estate_template_publication_changes() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('estate-template-publications', 0)
  );
  RETURN NULL;
END;
$$;


--
-- Name: persist_generated_estate_document(jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.persist_generated_estate_document(p_document jsonb, p_manifest jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_document_id uuid;
  v_document_version_id uuid;
  v_matter_id uuid;
  v_manifest_entry jsonb;
  v_clause_id uuid;
  v_revision_id uuid;
  v_override_id uuid;
  v_selection_reason text;
  v_included boolean;
  v_override_action text;
BEGIN
  IF jsonb_typeof(p_document) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Document metadata must be a JSON object';
  END IF;
  IF jsonb_typeof(p_manifest) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Clause manifest must be a JSON array';
  END IF;
  IF length(pg_catalog.btrim(COALESCE(p_document->>'r2_key', ''))) = 0
     OR length(pg_catalog.btrim(COALESCE(p_document->>'name', ''))) = 0 THEN
    RAISE EXCEPTION 'Document R2 key and name are required';
  END IF;
  IF COALESCE(p_document->>'generation_engine', '') <> 'node' THEN
    RAISE EXCEPTION 'Database estate clause provenance requires the Node generation engine';
  END IF;
  IF COALESCE((p_document->>'size')::bigint, -1) < 0
     OR COALESCE((p_document->>'marker_count')::integer, -1) < 0
     OR COALESCE((p_document->>'missing_count')::integer, -1) < 0 THEN
    RAISE EXCEPTION 'Document size and marker counts must be non-negative';
  END IF;

  v_matter_id := (p_document->>'matter_id')::uuid;
  IF NOT EXISTS (SELECT 1 FROM public.matters m WHERE m.id = v_matter_id) THEN
    RAISE EXCEPTION 'Matter not found';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = (p_document->>'actor_id')::uuid
      AND u.role IN ('attorney', 'admin')
  ) THEN
    RAISE EXCEPTION 'Attorney or administrator actor required';
  END IF;

  INSERT INTO public.matter_documents (
    matter_id, r2_key, name, size, content_type, uploaded_by,
    generation_id, generation_engine, marker_count, missing_count,
    template_id, template_version_id
  ) VALUES (
    v_matter_id::text,
    p_document->>'r2_key',
    p_document->>'name',
    COALESCE((p_document->>'size')::bigint, 0),
    COALESCE(p_document->>'content_type', 'application/octet-stream'),
    (p_document->>'actor_id')::uuid,
    (p_document->>'generation_id')::uuid,
    COALESCE(p_document->>'generation_engine', 'node'),
    (p_document->>'marker_count')::integer,
    (p_document->>'missing_count')::integer,
    p_document->>'template_id',
    (p_document->>'template_version_id')::uuid
  )
  RETURNING id INTO v_document_id;

  INSERT INTO public.document_versions (
    document_id, r2_key, source, version_number, filename, file_type,
    size_bytes, created_by
  ) VALUES (
    v_document_id,
    p_document->>'r2_key',
    'generated',
    1,
    p_document->>'name',
    p_document->>'content_type',
    COALESCE((p_document->>'size')::bigint, 0),
    (p_document->>'actor_id')::uuid
  )
  RETURNING id INTO v_document_version_id;

  FOR v_manifest_entry IN SELECT value FROM jsonb_array_elements(p_manifest)
  LOOP
    IF jsonb_typeof(v_manifest_entry) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Each clause manifest entry must be a JSON object';
    END IF;

    v_clause_id := (v_manifest_entry->>'clauseId')::uuid;
    v_revision_id := (v_manifest_entry->>'revisionId')::uuid;
    v_override_id := NULLIF(v_manifest_entry->>'overrideId', '')::uuid;
    v_selection_reason := v_manifest_entry->>'selectionReason';
    v_included := COALESCE((v_manifest_entry->>'included')::boolean, true);
    v_override_action := NULLIF(v_manifest_entry->>'overrideAction', '');

    IF NOT EXISTS (
      SELECT 1
      FROM public.estate_clause_revisions r
      JOIN public.estate_clauses c ON c.id = r.clause_id
      WHERE r.id = v_revision_id
        AND r.clause_id = v_clause_id
        AND r.content_hash = v_manifest_entry->>'contentHash'
        AND c.clause_key = v_manifest_entry->>'clauseKey'
    ) THEN
      RAISE EXCEPTION 'Clause manifest revision, clause key, or content hash is invalid';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.estate_clause_review_events e
      WHERE e.clause_id = v_clause_id
        AND e.revision_id = v_revision_id
        AND e.event_type = 'published'
    ) THEN
      RAISE EXCEPTION 'Clause manifest revision has no publication history';
    END IF;

    IF v_selection_reason = 'template_rule' AND (v_override_id IS NOT NULL OR NOT v_included) THEN
      RAISE EXCEPTION 'Template-rule selections cannot reference an override';
    ELSIF v_selection_reason = 'attorney_override' THEN
      IF v_override_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.matter_estate_clause_overrides o
        WHERE o.id = v_override_id
          AND o.matter_id = v_matter_id
          AND o.clause_id = v_clause_id
          AND o.event_type = 'applied'
          AND o.publication_revision_id = v_revision_id
          AND o.action = v_override_action
          AND o.action = CASE WHEN v_included THEN 'force_include' ELSE 'force_omit' END
      ) THEN
        RAISE EXCEPTION 'Attorney override does not belong to the matter and clause';
      END IF;
    ELSIF v_selection_reason NOT IN ('template_rule', 'attorney_override') THEN
      RAISE EXCEPTION 'Invalid clause selection reason';
    END IF;

    INSERT INTO public.generated_document_clause_revisions (
      document_version_id, clause_id, revision_id, clause_key, content_hash,
      included, inclusion_position, selection_reason, override_id, override_action
    ) VALUES (
      v_document_version_id, v_clause_id, v_revision_id,
      v_manifest_entry->>'clauseKey', v_manifest_entry->>'contentHash',
      v_included, NULLIF(v_manifest_entry->>'inclusionPosition', '')::integer,
      v_selection_reason, v_override_id, v_override_action
    );
  END LOOP;

  UPDATE public.matter_documents
  SET current_version_id = v_document_version_id
  WHERE id = v_document_id;

  RETURN jsonb_build_object(
    'documentId', v_document_id,
    'documentVersionId', v_document_version_id
  );
END;
$$;


--
-- Name: prevent_estate_clause_revision_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_estate_clause_revision_mutation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  RAISE EXCEPTION 'Estate clause revisions are immutable';
END;
$$;


--
-- Name: prevent_used_estate_clause_key_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_used_estate_clause_key_change() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF NEW.clause_key IS DISTINCT FROM OLD.clause_key
     AND (
       EXISTS (SELECT 1 FROM public.estate_clause_publications p WHERE p.clause_id = OLD.id)
       OR EXISTS (SELECT 1 FROM public.generated_document_clause_revisions g WHERE g.clause_id = OLD.id)
     ) THEN
    RAISE EXCEPTION 'A used estate clause key cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: publish_document_template_version(text, uuid, uuid, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.publish_document_template_version(p_template_id text, p_version_id uuid, p_expected_active_version_id uuid, p_actor_id uuid, p_confirmation text, p_event_type text DEFAULT 'published'::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_current uuid;
  v_status text;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_template_id, 0));

  IF p_event_type NOT IN ('published', 'rolled_back') THEN
    RAISE EXCEPTION 'Invalid publication event type';
  END IF;

  IF p_confirmation IS DISTINCT FROM p_template_id THEN
    RAISE EXCEPTION 'Template confirmation does not match';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_actor_id AND u.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Administrator role required';
  END IF;

  SELECT v.validation_status INTO v_status
  FROM public.document_template_versions v
  WHERE v.id = p_version_id AND v.template_id = p_template_id;

  IF v_status IS NULL THEN RAISE EXCEPTION 'Template version not found'; END IF;

  SELECT p.version_id INTO v_current
  FROM public.document_template_publications p
  WHERE p.template_id = p_template_id
  FOR UPDATE;

  IF v_current IS DISTINCT FROM p_expected_active_version_id THEN
    RAISE EXCEPTION 'Active template version changed; refresh and try again';
  END IF;

  INSERT INTO public.document_template_publications (
    template_id, version_id, published_by, published_at, updated_at
  ) VALUES (
    p_template_id, p_version_id, p_actor_id, now(), now()
  )
  ON CONFLICT (template_id) DO UPDATE SET
    version_id = EXCLUDED.version_id,
    published_by = EXCLUDED.published_by,
    published_at = EXCLUDED.published_at,
    updated_at = EXCLUDED.updated_at;

  INSERT INTO public.document_template_events (
    template_id, version_id, previous_version_id, event_type, actor_id, metadata
  ) VALUES (
    p_template_id,
    p_version_id,
    v_current,
    p_event_type,
    p_actor_id,
    jsonb_build_object('expectedActiveVersionId', p_expected_active_version_id)
  );

  RETURN jsonb_build_object(
    'templateId', p_template_id,
    'versionId', p_version_id,
    'previousVersionId', v_current
  );
END;
$$;


--
-- Name: publish_estate_clause_revision(uuid, uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.publish_estate_clause_revision(p_revision_id uuid, p_actor_id uuid, p_expected_current_revision_id uuid, p_current_template_snapshot_hash text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_clause_id uuid;
  v_clause_key text;
  v_validation_report jsonb;
  v_base_published_revision_id uuid;
  v_current_revision_id uuid;
  v_latest_event text;
  v_nested_clause_keys text[];
  v_dependency_revision_ids jsonb;
  v_dependency_missing boolean;
  v_dependency_cycle boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_actor_id AND u.role IN ('attorney', 'admin')
  ) THEN
    RAISE EXCEPTION 'Attorney or administrator role required';
  END IF;

  SELECT r.clause_id, r.validation_report,
         r.base_published_revision_id, r.nested_clause_keys, c.clause_key
  INTO v_clause_id, v_validation_report,
       v_base_published_revision_id, v_nested_clause_keys, v_clause_key
  FROM public.estate_clause_revisions r
  JOIN public.estate_clauses c ON c.id = r.clause_id
  WHERE r.id = p_revision_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estate clause revision not found';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('estate-clause-publications', 0)
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_clause_id::text, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('estate-template-publications', 0)
  );

  WITH RECURSIVE dependency_graph(clause_key, nested_keys, path, cycle, available, revision_id) AS (
    SELECT v_clause_key, v_nested_clause_keys, ARRAY[v_clause_key]::text[],
           false, true, p_revision_id
    UNION ALL
    SELECT child.clause_key, COALESCE(r.nested_clause_keys, '{}'::text[]),
           graph.path || child.clause_key, child.clause_key = ANY(graph.path),
           c.id IS NOT NULL AND p.current_revision_id IS NOT NULL, p.current_revision_id
    FROM dependency_graph graph
    CROSS JOIN LATERAL unnest(graph.nested_keys) child(clause_key)
    LEFT JOIN public.estate_clauses c ON c.clause_key = child.clause_key AND c.is_active
    LEFT JOIN public.estate_clause_publications p ON p.clause_id = c.id
    LEFT JOIN public.estate_clause_revisions r
      ON r.id = p.current_revision_id AND r.clause_id = c.id
    WHERE NOT graph.cycle AND graph.available
  )
  SELECT COALESCE(bool_or(NOT available), false), COALESCE(bool_or(cycle), false),
         COALESCE(jsonb_object_agg(clause_key, revision_id::text)
           FILTER (WHERE clause_key <> v_clause_key AND available AND NOT cycle), '{}'::jsonb)
  INTO v_dependency_missing, v_dependency_cycle, v_dependency_revision_ids
  FROM dependency_graph;
  IF v_dependency_missing THEN RAISE EXCEPTION 'Estate clause dependency has no current publication'; END IF;
  IF v_dependency_cycle THEN RAISE EXCEPTION 'Estate clause dependency graph contains a cycle'; END IF;

  PERFORM 1
  FROM public.estate_clause_publications p
  JOIN public.estate_clauses c ON c.id = p.clause_id
  WHERE c.clause_key IN (SELECT jsonb_object_keys(v_dependency_revision_ids))
  FOR SHARE OF p;

  SELECT e.event_type INTO v_latest_event
  FROM public.estate_clause_review_events e
  WHERE e.revision_id = p_revision_id
  ORDER BY e.created_at DESC, e.id DESC
  LIMIT 1;
  IF v_latest_event IS DISTINCT FROM 'submitted' THEN
    RAISE EXCEPTION 'Estate clause revision is not awaiting review';
  END IF;

  SELECT p.current_revision_id INTO v_current_revision_id
  FROM public.estate_clause_publications p
  WHERE p.clause_id = v_clause_id
  FOR UPDATE;

  IF v_base_published_revision_id IS DISTINCT FROM p_expected_current_revision_id THEN
    RAISE EXCEPTION 'Estate clause revision was drafted from a different publication';
  END IF;
  IF v_current_revision_id IS DISTINCT FROM p_expected_current_revision_id THEN
    RAISE EXCEPTION 'Current estate clause revision changed; refresh and try again';
  END IF;
  IF v_base_published_revision_id IS DISTINCT FROM v_current_revision_id THEN
    RAISE EXCEPTION 'Estate clause revision base is no longer current';
  END IF;

  INSERT INTO public.estate_clause_publications (
    clause_id, current_revision_id, published_by, published_at, updated_at
  ) VALUES (
    v_clause_id, p_revision_id, p_actor_id, now(), now()
  )
  ON CONFLICT (clause_id) DO UPDATE SET
    current_revision_id = EXCLUDED.current_revision_id,
    published_by = EXCLUDED.published_by,
    published_at = EXCLUDED.published_at,
    updated_at = EXCLUDED.updated_at;

  INSERT INTO public.estate_clause_review_events (
    clause_id, revision_id, event_type, actor_id, validation_report
  ) VALUES
    (v_clause_id, p_revision_id, 'approved', p_actor_id, v_validation_report),
    (v_clause_id, p_revision_id, 'published', p_actor_id, v_validation_report);

  RETURN jsonb_build_object(
    'clauseId', v_clause_id,
    'revisionId', p_revision_id,
    'previousRevisionId', v_current_revision_id
  );
END;
$$;


--
-- Name: rate_limit_consume(text, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rate_limit_consume(p_bucket text, p_key text, p_window_seconds integer) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_window_start timestamptz;
  v_count        integer;
BEGIN
  v_window_start := to_timestamp(
    floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds
  );

  INSERT INTO public.rate_limits (bucket, key, window_start, count)
  VALUES (p_bucket, p_key, v_window_start, 1)
  ON CONFLICT (bucket, key, window_start)
  DO UPDATE SET count = public.rate_limits.count + 1
  RETURNING count INTO v_count;

  RETURN v_count;
END;
$$;


--
-- Name: record_estate_clause_preview(uuid, text, text[], jsonb, uuid, jsonb, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_estate_clause_preview(p_revision_id uuid, p_template_snapshot_hash text, p_document_types text[], p_dependency_revision_ids jsonb, p_representative_matter_id uuid, p_validation_report jsonb, p_actor_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_evidence_id uuid;
  v_clause_id uuid;
  v_content_hash text;
  v_declared_types text[];
  v_template_publication_revision_ids jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_actor_id AND u.role IN ('attorney', 'admin')) THEN
    RAISE EXCEPTION 'Attorney or administrator role required';
  END IF;
  SELECT r.clause_id, r.content_hash, c.document_types
  INTO v_clause_id, v_content_hash, v_declared_types
  FROM public.estate_clause_revisions r
  JOIN public.estate_clauses c ON c.id = r.clause_id
  WHERE r.id = p_revision_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Estate clause revision not found'; END IF;
  IF p_validation_report->>'status' <> 'passed'
     OR COALESCE((p_validation_report->>'missingCount')::integer, 1) <> 0
     OR COALESCE((p_validation_report->>'warningCount')::integer, 1) <> 0
     OR COALESCE((p_validation_report->>'unresolvedMarkerCount')::integer, 1) <> 0
     OR NOT (p_document_types @> v_declared_types) THEN
    RAISE EXCEPTION 'Candidate preview has blockers or incomplete document-type coverage';
  END IF;
  IF jsonb_typeof(p_dependency_revision_ids) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Candidate preview dependency revisions must be a JSON object';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('estate-clause-publications', 0)
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('estate-template-publications', 0)
  );
  SELECT COALESCE(jsonb_object_agg(p.template_id, p.version_id::text ORDER BY p.template_id), '{}'::jsonb)
  INTO v_template_publication_revision_ids
  FROM public.document_template_publications p
  WHERE p.template_id LIKE 'estate-%';
  INSERT INTO public.estate_clause_preview_evidence (
    clause_id, revision_id, revision_content_hash, template_snapshot_hash,
    document_types, dependency_revision_ids, template_publication_revision_ids,
    representative_matter_id,
    validation_report, created_by
  ) VALUES (
    v_clause_id, p_revision_id, v_content_hash, p_template_snapshot_hash,
    p_document_types, p_dependency_revision_ids, v_template_publication_revision_ids,
    p_representative_matter_id,
    p_validation_report, p_actor_id
  ) RETURNING id INTO v_evidence_id;
  RETURN v_evidence_id;
END;
$$;


--
-- Name: request_estate_clause_changes(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.request_estate_clause_changes(p_revision_id uuid, p_actor_id uuid, p_comment text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_revision public.estate_clause_revisions%ROWTYPE;
  v_event_id uuid;
  v_latest_event text;
BEGIN
  IF length(pg_catalog.btrim(COALESCE(p_comment, ''))) = 0 THEN
    RAISE EXCEPTION 'A reviewer comment is required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_actor_id AND u.role IN ('attorney', 'admin')
  ) THEN
    RAISE EXCEPTION 'Attorney or administrator role required';
  END IF;

  SELECT r.*
  INTO v_revision
  FROM public.estate_clause_revisions r
  WHERE r.id = p_revision_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estate clause revision not found';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_revision.clause_id::text, 0));
  SELECT e.event_type INTO v_latest_event
  FROM public.estate_clause_review_events e
  WHERE e.revision_id = p_revision_id
  ORDER BY e.created_at DESC, e.id DESC
  LIMIT 1;
  IF v_latest_event IS DISTINCT FROM 'submitted' THEN
    RAISE EXCEPTION 'Estate clause revision is not awaiting review';
  END IF;

  INSERT INTO public.estate_clause_review_events (
    clause_id, revision_id, event_type, actor_id, comment
  ) VALUES (
    v_revision.clause_id, p_revision_id, 'changes_requested', p_actor_id, p_comment
  )
  RETURNING id INTO v_event_id;

  -- Restore the immutable submitted text into an author-owned working draft.
  -- The author can continue from the reviewed proposal. Never overwrite a
  -- newer draft the author may already have started while review was pending.
  INSERT INTO public.estate_clause_working_drafts (
    clause_id, base_published_revision_id, clause_text, required_fields,
    nested_clause_keys, condition_field, change_summary, content_hash,
    validation_status, validation_report, author_id, source_review_revision_id
  ) VALUES (
    v_revision.clause_id, v_revision.base_published_revision_id,
    v_revision.clause_text, v_revision.required_fields,
    v_revision.nested_clause_keys, v_revision.condition_field,
    v_revision.change_summary, v_revision.content_hash,
    v_revision.validation_status, v_revision.validation_report,
    v_revision.author_id, v_revision.id
  )
  ON CONFLICT (clause_id, author_id) DO NOTHING;

  RETURN v_event_id;
END;
$$;


--
-- Name: retire_estate_clause_publication(uuid, uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.retire_estate_clause_publication(p_clause_id uuid, p_expected_current_revision_id uuid, p_reason text, p_actor_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_current_revision_id uuid;
  v_event_id uuid;
BEGIN
  IF length(pg_catalog.btrim(COALESCE(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'Retirement reason is required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_actor_id AND u.role IN ('attorney', 'admin')) THEN
    RAISE EXCEPTION 'Attorney or administrator role required';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('estate-clause-publications', 0)
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_clause_id::text, 0));
  SELECT p.current_revision_id INTO v_current_revision_id
  FROM public.estate_clause_publications p WHERE p.clause_id = p_clause_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Current estate clause publication not found'; END IF;
  IF v_current_revision_id IS DISTINCT FROM p_expected_current_revision_id THEN
    RAISE EXCEPTION 'Current estate clause revision changed; refresh and try again';
  END IF;
  INSERT INTO public.estate_clause_review_events (
    clause_id, revision_id, event_type, actor_id, comment, metadata
  ) VALUES (
    p_clause_id, v_current_revision_id, 'retired', p_actor_id, pg_catalog.btrim(p_reason),
    jsonb_build_object('expectedCurrentRevisionId', p_expected_current_revision_id)
  ) RETURNING id INTO v_event_id;
  DELETE FROM public.estate_clause_publications p WHERE p.clause_id = p_clause_id;
  RETURN v_event_id;
END;
$$;


--
-- Name: retire_matter_estate_clause_override(uuid, uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.retire_matter_estate_clause_override(p_matter_id uuid, p_clause_id uuid, p_reason text, p_actor_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_current public.matter_estate_clause_overrides%ROWTYPE;
  v_retirement public.matter_estate_clause_overrides%ROWTYPE;
BEGIN
  IF length(pg_catalog.btrim(COALESCE(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'Estate clause override retirement reason must be at least 10 characters';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_actor_id AND u.role IN ('attorney', 'admin')) THEN
    RAISE EXCEPTION 'Attorney or administrator role required';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_matter_id::text || ':' || p_clause_id::text, 0));
  SELECT o.* INTO v_current
  FROM public.matter_estate_clause_overrides o
  WHERE o.matter_id = p_matter_id AND o.clause_id = p_clause_id
  ORDER BY o.created_at DESC, o.id DESC LIMIT 1;
  IF NOT FOUND OR v_current.event_type <> 'applied' THEN
    RAISE EXCEPTION 'Active estate clause override not found';
  END IF;
  INSERT INTO public.matter_estate_clause_overrides (
    matter_id, clause_id, publication_revision_id, event_type, action,
    reason, created_by, supersedes_override_id
  ) VALUES (
    p_matter_id, p_clause_id, v_current.publication_revision_id, 'retired', NULL,
    pg_catalog.btrim(p_reason), p_actor_id, v_current.id
  ) RETURNING * INTO v_retirement;
  RETURN pg_catalog.to_jsonb(v_retirement);
END;
$$;


--
-- Name: revert_estate_clause_publication(uuid, uuid, uuid, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.revert_estate_clause_publication(p_clause_id uuid, p_target_revision_id uuid, p_expected_current_revision_id uuid, p_current_template_snapshot_hash text, p_reason text, p_actor_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_current_revision_id uuid;
  v_event_id uuid;
  v_clause_key text;
  v_nested_clause_keys text[];
  v_dependency_revision_ids jsonb;
  v_template_publication_revision_ids jsonb;
  v_dependency_missing boolean;
  v_dependency_cycle boolean;
BEGIN
  IF length(pg_catalog.btrim(COALESCE(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'Reversion reason is required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_actor_id AND u.role IN ('attorney', 'admin')) THEN
    RAISE EXCEPTION 'Attorney or administrator role required';
  END IF;
  SELECT r.nested_clause_keys, c.clause_key
  INTO v_nested_clause_keys, v_clause_key
  FROM public.estate_clause_revisions r
  JOIN public.estate_clauses c ON c.id = r.clause_id
  WHERE r.id = p_target_revision_id AND r.clause_id = p_clause_id AND r.validation_status = 'valid';
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.estate_clause_review_events e
    WHERE e.clause_id = p_clause_id AND e.revision_id = p_target_revision_id AND e.event_type = 'published'
  ) THEN RAISE EXCEPTION 'Target revision has no approved publication history'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('estate-clause-publications', 0)
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_clause_id::text, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('estate-template-publications', 0)
  );
  WITH RECURSIVE dependency_graph(clause_key, nested_keys, path, cycle, available, revision_id) AS (
    SELECT v_clause_key, v_nested_clause_keys, ARRAY[v_clause_key]::text[], false, true, p_target_revision_id
    UNION ALL
    SELECT child.clause_key, COALESCE(r.nested_clause_keys, '{}'::text[]),
           graph.path || child.clause_key, child.clause_key = ANY(graph.path),
           c.id IS NOT NULL AND p.current_revision_id IS NOT NULL, p.current_revision_id
    FROM dependency_graph graph
    CROSS JOIN LATERAL unnest(graph.nested_keys) child(clause_key)
    LEFT JOIN public.estate_clauses c ON c.clause_key = child.clause_key AND c.is_active
    LEFT JOIN public.estate_clause_publications p ON p.clause_id = c.id
    LEFT JOIN public.estate_clause_revisions r ON r.id = p.current_revision_id AND r.clause_id = c.id
    WHERE NOT graph.cycle AND graph.available
  )
  SELECT COALESCE(bool_or(NOT available), false), COALESCE(bool_or(cycle), false),
         COALESCE(jsonb_object_agg(clause_key, revision_id::text)
           FILTER (WHERE clause_key <> v_clause_key AND available AND NOT cycle), '{}'::jsonb)
  INTO v_dependency_missing, v_dependency_cycle, v_dependency_revision_ids
  FROM dependency_graph;
  IF v_dependency_missing THEN RAISE EXCEPTION 'Estate clause dependency has no current publication'; END IF;
  IF v_dependency_cycle THEN RAISE EXCEPTION 'Estate clause dependency graph contains a cycle'; END IF;
  PERFORM 1 FROM public.estate_clause_publications p
  JOIN public.estate_clauses c ON c.id = p.clause_id
  WHERE c.clause_key IN (SELECT jsonb_object_keys(v_dependency_revision_ids))
  FOR SHARE OF p;
  SELECT COALESCE(jsonb_object_agg(p.template_id, p.version_id::text ORDER BY p.template_id), '{}'::jsonb)
  INTO v_template_publication_revision_ids
  FROM public.document_template_publications p WHERE p.template_id LIKE 'estate-%';
  IF NOT EXISTS (
    SELECT 1 FROM public.estate_clause_preview_evidence pe
    WHERE pe.clause_id = p_clause_id
      AND pe.revision_id = p_target_revision_id
      AND pe.template_snapshot_hash = p_current_template_snapshot_hash
      AND pe.dependency_revision_ids = v_dependency_revision_ids
      AND pe.template_publication_revision_ids = v_template_publication_revision_ids
      AND pe.validation_report->>'status' = 'passed'
  ) THEN RAISE EXCEPTION 'Current preview evidence is required before publication reversion'; END IF;
  SELECT p.current_revision_id INTO v_current_revision_id
  FROM public.estate_clause_publications p WHERE p.clause_id = p_clause_id FOR UPDATE;
  IF v_current_revision_id IS DISTINCT FROM p_expected_current_revision_id THEN
    RAISE EXCEPTION 'Current estate clause revision changed; refresh and try again';
  END IF;
  INSERT INTO public.estate_clause_publications (clause_id, current_revision_id, published_by, published_at, updated_at)
  VALUES (p_clause_id, p_target_revision_id, p_actor_id, now(), now())
  ON CONFLICT (clause_id) DO UPDATE SET current_revision_id = EXCLUDED.current_revision_id,
    published_by = EXCLUDED.published_by, published_at = EXCLUDED.published_at, updated_at = EXCLUDED.updated_at;
  INSERT INTO public.estate_clause_review_events (
    clause_id, revision_id, event_type, actor_id, comment, metadata
  ) VALUES (
    p_clause_id, p_target_revision_id, 'publication_reverted', p_actor_id, pg_catalog.btrim(p_reason),
    jsonb_build_object('expectedCurrentRevisionId', p_expected_current_revision_id, 'previousRevisionId', v_current_revision_id)
  ) RETURNING id INTO v_event_id;
  RETURN v_event_id;
END;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: submit_estate_clause_revision(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.submit_estate_clause_revision(p_working_draft_id uuid, p_actor_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_draft public.estate_clause_working_drafts%ROWTYPE;
  v_revision_id uuid;
  v_revision_number integer;
  v_clause_key text;
  v_dependency_missing boolean;
  v_dependency_cycle boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_actor_id AND u.role IN ('attorney', 'admin')
  ) THEN
    RAISE EXCEPTION 'Attorney or administrator role required';
  END IF;

  SELECT d.* INTO v_draft
  FROM public.estate_clause_working_drafts d
  WHERE d.id = p_working_draft_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estate clause working draft not found';
  END IF;
  IF v_draft.author_id <> p_actor_id THEN
    RAISE EXCEPTION 'Only the working draft author may submit it';
  END IF;

  SELECT c.clause_key INTO v_clause_key FROM public.estate_clauses c WHERE c.id = v_draft.clause_id;
  WITH RECURSIVE dependency_graph(clause_key, nested_keys, path, cycle, available) AS (
    SELECT v_clause_key, v_draft.nested_clause_keys, ARRAY[v_clause_key]::text[], false, true
    UNION ALL
    SELECT child.clause_key,
           COALESCE(r.nested_clause_keys, '{}'::text[]),
           graph.path || child.clause_key,
           child.clause_key = ANY(graph.path),
           c.id IS NOT NULL AND p.current_revision_id IS NOT NULL
    FROM dependency_graph graph
    CROSS JOIN LATERAL unnest(graph.nested_keys) child(clause_key)
    LEFT JOIN public.estate_clauses c ON c.clause_key = child.clause_key AND c.is_active
    LEFT JOIN public.estate_clause_publications p ON p.clause_id = c.id
    LEFT JOIN public.estate_clause_revisions r
      ON r.id = p.current_revision_id AND r.clause_id = c.id
    WHERE NOT graph.cycle AND graph.available
  )
  SELECT COALESCE(bool_or(NOT available), false), COALESCE(bool_or(cycle), false)
  INTO v_dependency_missing, v_dependency_cycle
  FROM dependency_graph;
  IF v_dependency_missing THEN
    RAISE EXCEPTION 'Estate clause dependency has no current publication';
  END IF;
  IF v_dependency_cycle THEN
    RAISE EXCEPTION 'Estate clause dependency graph contains a cycle';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_draft.clause_id::text, 0));
  SELECT COALESCE(MAX(r.revision_number), 0) + 1
  INTO v_revision_number
  FROM public.estate_clause_revisions r
  WHERE r.clause_id = v_draft.clause_id;

  INSERT INTO public.estate_clause_revisions (
    clause_id, revision_number, clause_text, required_fields, nested_clause_keys,
    condition_field, content_hash, change_summary, validation_status,
    validation_report, author_id, base_published_revision_id
  ) VALUES (
    v_draft.clause_id, v_revision_number, v_draft.clause_text,
    v_draft.required_fields, v_draft.nested_clause_keys, v_draft.condition_field,
    v_draft.content_hash, v_draft.change_summary, v_draft.validation_status,
    v_draft.validation_report, p_actor_id, v_draft.base_published_revision_id
  )
  RETURNING id INTO v_revision_id;

  INSERT INTO public.estate_clause_review_events (
    clause_id, revision_id, event_type, actor_id, validation_report
  ) VALUES (
    v_draft.clause_id, v_revision_id, 'submitted', p_actor_id, v_draft.validation_report
  );

  DELETE FROM public.estate_clause_working_drafts
  WHERE id = p_working_draft_id;

  RETURN v_revision_id;
END;
$$;


--
-- Name: client_intake; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_intake (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    client_user_id uuid,
    matter_id uuid,
    email text,
    first_name text,
    middle_name text,
    last_name text,
    full_name text,
    preferred_pronoun text,
    date_of_birth date,
    phone text,
    address_line1 text,
    address_line2 text,
    city text,
    state text,
    zip text,
    county text,
    marital_status text,
    has_minor_children boolean,
    plan_type text,
    taxable_estate numeric,
    practice_area text,
    status text DEFAULT 'draft'::text NOT NULL,
    intake_sent_at timestamp with time zone,
    is_us_citizen boolean DEFAULT true,
    fiduciary_entries jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    intake_completed_at timestamp with time zone,
    referral_source text,
    goals jsonb,
    additional_contacts jsonb,
    family_details jsonb,
    financial_details jsonb,
    document_inclusions jsonb,
    current_step text,
    unlock_requested_at timestamp with time zone,
    intake_invite_token uuid DEFAULT gen_random_uuid(),
    preferred_name text,
    citizenship text,
    occupation text,
    employer text,
    marriage_date date,
    prior_marriage boolean,
    notes text,
    lead_source text,
    intake_token_hash text,
    intake_token_expires_at timestamp with time zone,
    intake_token_last_used_at timestamp with time zone,
    suffix text,
    prior_names text,
    has_children boolean,
    date_of_marriage date,
    estate_value text,
    has_real_property boolean,
    has_retirement boolean,
    has_investments boolean,
    has_business boolean,
    has_life_insurance boolean,
    has_ltc_insurance boolean,
    has_existing_plan boolean,
    has_major_illness boolean,
    has_family_disability boolean,
    has_prior_gift_tax boolean,
    is_trust_beneficiary boolean,
    has_divorce_settlement boolean,
    planning_goals text[],
    planning_objectives text,
    review_choices jsonb,
    spouse_as_fiduciary boolean,
    excluded_guardian text,
    excluded_guardian_2 text,
    special_notes text,
    other_individuals jsonb,
    attorney_review_flags jsonb DEFAULT '[]'::jsonb NOT NULL,
    unlock_request_note text,
    uploads_reviewed_at timestamp with time zone,
    probate_details jsonb,
    lawmatics_matter_id text,
    lead_status text,
    lead_next_action_snoozed_until timestamp with time zone,
    engagement_provider text,
    engagement_envelope_id text,
    engagement_status text,
    engagement_sent_at timestamp with time zone,
    engagement_signed_at timestamp with time zone,
    engagement_fee_quoted numeric,
    intake_link_version uuid,
    intake_link_created_at timestamp with time zone,
    intake_link_revoked_at timestamp with time zone,
    lead_urgency text,
    qualification_notes text,
    intake_track text DEFAULT 'estate'::text NOT NULL,
    college_prep_details jsonb,
    billing_type text,
    legal_plan_member_id text,
    legal_plan_service_start date,
    legal_plan_service_end date,
    additional_emails jsonb DEFAULT '[]'::jsonb NOT NULL,
    additional_phones jsonb DEFAULT '[]'::jsonb NOT NULL,
    citizenship_status text,
    has_will boolean,
    has_trust boolean,
    has_poa boolean,
    has_hcp boolean,
    special_circumstances text[],
    form_version_id uuid,
    CONSTRAINT client_intake_additional_emails_shape CHECK (public.is_contact_channel_list(additional_emails)),
    CONSTRAINT client_intake_additional_phones_shape CHECK (public.is_contact_channel_list(additional_phones)),
    CONSTRAINT client_intake_billing_type_check CHECK (((billing_type IS NULL) OR (billing_type = ANY (ARRAY['flat_fee'::text, 'metlife'::text, 'legalease'::text, 'arag'::text, 'clc'::text, 'other_legal_plan'::text])))),
    CONSTRAINT client_intake_citizenship_status_check CHECK (((citizenship_status IS NULL) OR (citizenship_status = ANY (ARRAY['unknown'::text, 'us_citizen'::text, 'permanent_resident'::text, 'nonresident_alien'::text, 'non_us_unspecified'::text, 'other'::text])))),
    CONSTRAINT client_intake_intake_track_check CHECK ((intake_track = ANY (ARRAY['estate'::text, 'college_prep'::text]))),
    CONSTRAINT client_intake_lead_urgency_check CHECK (((lead_urgency IS NULL) OR (lead_urgency = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text]))))
);


--
-- Name: TABLE client_intake; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.client_intake IS 'Client questionnaires and CRM leads. Clients may read their own row and nothing else: every write goes through the service-role client, which is what makes the submitted/approved lock enforceable rather than advisory.';


--
-- Name: COLUMN client_intake.uploads_reviewed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.client_intake.uploads_reviewed_at IS 'When staff last opened/reviewed questionnaire uploads; uploads after this timestamp are unreviewed.';


--
-- Name: COLUMN client_intake.probate_details; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.client_intake.probate_details IS 'Probate matter details from the admin intake sheet: decedent_name, date_of_death, domicile, estate_value, known_assets, known_debts, petitioner_relationship, goals_timeline.';


--
-- Name: COLUMN client_intake.intake_link_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.client_intake.intake_link_version IS 'Public nonce included in the application-signed standing intake URL. Rotate to invalidate prior links.';


--
-- Name: COLUMN client_intake.intake_link_revoked_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.client_intake.intake_link_revoked_at IS 'When set, the current standing intake link is invalid.';


--
-- Name: COLUMN client_intake.intake_track; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.client_intake.intake_track IS 'Which guided-interview question set this intake uses: estate | college_prep.';


--
-- Name: COLUMN client_intake.college_prep_details; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.client_intake.college_prep_details IS 'College Preparation Plan answers (school, parents, DPOA scope, HIPAA, living will). Keys are the wizard field ids minus the college_ prefix.';


--
-- Name: COLUMN client_intake.additional_emails; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.client_intake.additional_emails IS 'Secondary email addresses for the client, beyond client_intake.email.';


--
-- Name: COLUMN client_intake.additional_phones; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.client_intake.additional_phones IS 'Secondary phone numbers for the client, beyond client_intake.phone.';


--
-- Name: COLUMN client_intake.citizenship_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.client_intake.citizenship_status IS 'Canonical citizenship/immigration-status answer. is_us_citizen is retained temporarily for compatibility.';


--
-- Name: upsert_matter_estate_clause_override(uuid, uuid, uuid, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_matter_estate_clause_override(p_matter_id uuid, p_clause_id uuid, p_expected_current_revision_id uuid, p_action text, p_reason text, p_actor_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_current_revision_id uuid;
  v_condition_field text;
  v_override public.matter_estate_clause_overrides%ROWTYPE;
BEGIN
  IF p_action NOT IN ('force_include', 'force_omit') THEN
    RAISE EXCEPTION 'Invalid estate clause override action';
  END IF;
  IF length(pg_catalog.btrim(COALESCE(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'Estate clause override reason must be at least 10 characters';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_actor_id AND u.role IN ('attorney', 'admin')
  ) THEN
    RAISE EXCEPTION 'Attorney or administrator role required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.matters m WHERE m.id = p_matter_id) THEN
    RAISE EXCEPTION 'Matter not found';
  END IF;

  SELECT p.current_revision_id, r.condition_field
  INTO v_current_revision_id, v_condition_field
  FROM public.estate_clause_publications p
  JOIN public.estate_clause_revisions r
    ON r.id = p.current_revision_id AND r.clause_id = p.clause_id
  JOIN public.estate_clauses c ON c.id = p.clause_id
  WHERE p.clause_id = p_clause_id
    AND c.is_active
  FOR UPDATE OF p;

  IF NOT FOUND OR v_condition_field IS NULL OR length(pg_catalog.btrim(v_condition_field)) = 0 THEN
    RAISE EXCEPTION 'Estate clause is not a current active conditional publication';
  END IF;
  IF v_current_revision_id IS DISTINCT FROM p_expected_current_revision_id THEN
    RAISE EXCEPTION 'Current estate clause revision changed; refresh and try again';
  END IF;

  INSERT INTO public.matter_estate_clause_overrides (
    matter_id, clause_id, publication_revision_id, event_type, action,
    reason, created_by, supersedes_override_id
  ) VALUES (
    p_matter_id, p_clause_id, v_current_revision_id, 'applied', p_action,
    pg_catalog.btrim(p_reason), p_actor_id,
    (SELECT o.id FROM public.matter_estate_clause_overrides o
     WHERE o.matter_id = p_matter_id AND o.clause_id = p_clause_id
     ORDER BY o.created_at DESC, o.id DESC LIMIT 1)
  )
  RETURNING * INTO v_override;

  RETURN pg_catalog.to_jsonb(v_override);
END;
$$;


--
-- Name: ai_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_usage (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid,
    route text NOT NULL,
    context_type text,
    matter_id uuid,
    model text NOT NULL,
    input_tokens integer DEFAULT 0 NOT NULL,
    output_tokens integer DEFAULT 0 NOT NULL,
    cache_read_input_tokens integer DEFAULT 0 NOT NULL,
    cache_creation_input_tokens integer DEFAULT 0 NOT NULL,
    duration_ms integer,
    success boolean DEFAULT true NOT NULL,
    error_message text,
    workflow_run_id uuid
);


--
-- Name: contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_intake_id uuid,
    relationship_type text NOT NULL,
    relationship_label text,
    first_name text,
    middle_name text,
    last_name text,
    suffix text,
    preferred_name text,
    preferred_pronoun text,
    prior_names text,
    date_of_birth date,
    is_us_citizen boolean,
    phone text,
    email text,
    address_line1 text,
    address_line2 text,
    city text,
    state text,
    zip text,
    county text,
    child_relationship text,
    parentage text,
    source text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_minor boolean,
    created_by_client_at timestamp with time zone,
    gender text,
    deceased boolean,
    lawmatics_contact_id text,
    from_prior_relationship boolean DEFAULT false,
    additional_emails jsonb DEFAULT '[]'::jsonb NOT NULL,
    additional_phones jsonb DEFAULT '[]'::jsonb NOT NULL,
    citizenship_status text,
    merged_into_id uuid,
    merged_at timestamp with time zone,
    CONSTRAINT contacts_additional_emails_shape CHECK (public.is_contact_channel_list(additional_emails)),
    CONSTRAINT contacts_additional_phones_shape CHECK (public.is_contact_channel_list(additional_phones)),
    CONSTRAINT contacts_child_relationship_check CHECK (((child_relationship IS NULL) OR (child_relationship = ANY (ARRAY['biological'::text, 'adopted'::text, 'stepchild'::text])))),
    CONSTRAINT contacts_citizenship_status_check CHECK (((citizenship_status IS NULL) OR (citizenship_status = ANY (ARRAY['unknown'::text, 'us_citizen'::text, 'permanent_resident'::text, 'nonresident_alien'::text, 'non_us_unspecified'::text, 'other'::text])))),
    CONSTRAINT contacts_parentage_check CHECK (((parentage IS NULL) OR (parentage = ANY (ARRAY['joint'::text, 'client'::text, 'spouse'::text]))))
);


--
-- Name: COLUMN contacts.from_prior_relationship; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contacts.from_prior_relationship IS 'Child of a prior relationship — changes the residuary and guardian analysis.';


--
-- Name: COLUMN contacts.additional_emails; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contacts.additional_emails IS 'Secondary email addresses for this contact, beyond contacts.email.';


--
-- Name: COLUMN contacts.additional_phones; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contacts.additional_phones IS 'Secondary phone numbers for this contact, beyond contacts.phone.';


--
-- Name: COLUMN contacts.citizenship_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contacts.citizenship_status IS 'Canonical citizenship/immigration-status answer. is_us_citizen is retained temporarily for compatibility.';


--
-- Name: COLUMN contacts.merged_into_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contacts.merged_into_id IS 'Set when this row was merged into another person. The row is kept rather than deleted so a bad merge is reversible and any link that still points here resolves.';


--
-- Name: matter_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.matter_contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    matter_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    relationship_type text NOT NULL,
    relationship_label text,
    for_party text,
    child_relationship text,
    parentage text,
    from_prior_relationship boolean,
    is_minor boolean,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE matter_contacts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.matter_contacts IS 'Join between a matter and every person on it. One row per person per matter; carries the facts that are relative to the matter rather than intrinsic to the person.';


--
-- Name: COLUMN matter_contacts.relationship_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.matter_contacts.relationship_type IS 'This person''s relationship to the matter''s primary client: self | spouse | child | other. Deliberately un-CHECKed — contacts.relationship_type carries free-text and legacy ''client'' values that the backfill copies across verbatim rather than flattening.';


--
-- Name: COLUMN matter_contacts.for_party; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.matter_contacts.for_party IS 'Which side of a joint matter this person belongs to (client | spouse), where it matters.';


--
-- Name: contact_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contact_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contact_id uuid NOT NULL,
    role text NOT NULL,
    for_party text DEFAULT 'client'::text NOT NULL,
    priority integer DEFAULT 1 NOT NULL,
    is_coagent boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    client_intake_id uuid,
    matter_id uuid
);


--
-- Name: COLUMN contact_roles.matter_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contact_roles.matter_id IS 'The matter this appointment belongs to. Backfilled from client_intake_id, which is retired in step 3 of docs/matter-contacts-migration.md.';


--
-- Name: custom_document_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.custom_document_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    label text NOT NULL,
    output_filename text NOT NULL,
    storage_path text NOT NULL,
    byte_size bigint NOT NULL,
    sha256 text NOT NULL,
    variables jsonb DEFAULT '[]'::jsonb NOT NULL,
    clauses jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    CONSTRAINT custom_document_templates_byte_size_check CHECK (((byte_size > 0) AND (byte_size <= 15728640))),
    CONSTRAINT custom_document_templates_label_check CHECK (((char_length(label) >= 1) AND (char_length(label) <= 120))),
    CONSTRAINT custom_document_templates_output_filename_check CHECK ((output_filename ~ '\.docx$'::text)),
    CONSTRAINT custom_document_templates_sha256_check CHECK ((sha256 ~ '^[0-9a-f]{64}$'::text))
);


--
-- Name: design_sheets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.design_sheets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    matter_id uuid NOT NULL,
    client_intake_id uuid,
    version integer DEFAULT 1 NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    plan_type text,
    is_joint boolean,
    decisions jsonb DEFAULT '{}'::jsonb NOT NULL,
    overrides jsonb,
    goals_notes text,
    concerns text,
    assets jsonb DEFAULT '[]'::jsonb,
    children jsonb DEFAULT '[]'::jsonb,
    trustee_slots jsonb DEFAULT '[]'::jsonb,
    executor_slots jsonb DEFAULT '[]'::jsonb,
    poa_slots jsonb DEFAULT '[]'::jsonb,
    hcp_slots jsonb DEFAULT '[]'::jsonb,
    guardian_slots jsonb DEFAULT '[]'::jsonb,
    temporary_guardian_slots jsonb DEFAULT '[]'::jsonb,
    spouse_trustee_slots jsonb DEFAULT '[]'::jsonb,
    spouse_executor_slots jsonb DEFAULT '[]'::jsonb,
    spouse_poa_slots jsonb DEFAULT '[]'::jsonb,
    spouse_hcp_slots jsonb DEFAULT '[]'::jsonb,
    specific_bequests jsonb DEFAULT '[]'::jsonb,
    disinheritances jsonb DEFAULT '[]'::jsonb,
    fiduciary_slot_states jsonb DEFAULT '{}'::jsonb,
    trust_name text,
    spouse_trust_name text,
    restatement boolean,
    trust_protector text,
    distribution_age integer,
    residuary_beneficiary text,
    residual_beneficiary_individuals jsonb DEFAULT '[]'::jsonb,
    staggered_distributions jsonb DEFAULT '[]'::jsonb,
    remote_beneficiary text,
    remote_beneficiary_individuals jsonb DEFAULT '[]'::jsonb,
    remote_beneficiary_charities jsonb DEFAULT '[]'::jsonb,
    signing_date date,
    signing_county text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    client_name text,
    client_dob date,
    client_phone text,
    client_email text,
    client_citizenship text,
    client_domicile text,
    client_pronouns text,
    client_aka text,
    street text,
    city text,
    state text,
    zip text,
    county text,
    marital_status text,
    spouse_name text,
    spouse_dob date,
    spouse_phone text,
    spouse_email text,
    spouse_citizenship text,
    spouse_pronouns text,
    marriage_date date,
    trustee_primary text,
    trustee_co text,
    trustee_alt1 text,
    trustee_alt1_co text,
    trustee_alt2 text,
    executor_primary text,
    executor_co text,
    executor_alt1 text,
    executor_alt1_co text,
    executor_same_as_trustee boolean DEFAULT false,
    spouse_executor_same_as_trustee boolean DEFAULT false,
    poa_primary text,
    poa_co text,
    poa_alt1 text,
    poa_same_as_trustee boolean DEFAULT false,
    hcp_primary text,
    hcp_co text,
    hcp_alt1 text,
    hcp_alt1_co text,
    guardian_primary text,
    guardian_co text,
    guardian_alt1 text,
    guardian_alt1_co text,
    flags text[] DEFAULT '{}'::text[],
    drafting_notes text,
    real_property_transfer text,
    trust_type text,
    marital_trust_type text,
    marital_trust_remarriage text,
    include_qdot text,
    family_trust_remarriage text,
    common_trust text,
    residuary_distribution text,
    withdrawal_right text,
    poa_client_co_authority text,
    poa_spouse_co_authority text,
    marital_status_clause text,
    doc_date date,
    ordinal_doc_date text,
    notary_commission text,
    notary_commission_expiration date,
    signing_month text,
    signing_year text,
    former_spouse_name text,
    deceased_spouse_name text,
    intake_review_flags jsonb DEFAULT '[]'::jsonb NOT NULL,
    excluded_guardian_flag boolean DEFAULT false,
    excluded_guardian_name text,
    lock_version integer DEFAULT 0 NOT NULL
);


--
-- Name: COLUMN design_sheets.lock_version; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.design_sheets.lock_version IS 'Optimistic-concurrency token. Callers pass the value they read; the update increments it and matches on it, so a save against a stale read affects no rows. Distinct from `version`, which identifies the sheet revision.';


--
-- Name: doc_selections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.doc_selections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    design_sheet_id uuid NOT NULL,
    doc_type text,
    variant text,
    party text,
    selected boolean DEFAULT true NOT NULL,
    sort_order integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: document_access_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_access_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_id uuid,
    matter_id text NOT NULL,
    user_id uuid,
    user_email text,
    action text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    document_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT document_access_audit_action_check CHECK ((action = ANY (ARRAY['view'::text, 'download'::text, 'folder_change'::text, 'delete'::text, 'export'::text, 'review'::text, 'rename'::text, 'edit'::text, 'convert'::text, 'version'::text])))
);


--
-- Name: document_template_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_template_events (
    id bigint NOT NULL,
    template_id text NOT NULL,
    version_id uuid,
    previous_version_id uuid,
    event_type text NOT NULL,
    actor_id uuid NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT document_template_events_event_type_check CHECK ((event_type = ANY (ARRAY['uploaded'::text, 'validated'::text, 'validation_failed'::text, 'published'::text, 'rolled_back'::text, 'canceled'::text])))
);


--
-- Name: document_template_publications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_template_publications (
    template_id text NOT NULL,
    version_id uuid NOT NULL,
    published_by uuid NOT NULL,
    published_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: document_template_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_template_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    template_id text NOT NULL,
    version_number bigint NOT NULL,
    storage_path text NOT NULL,
    original_filename text NOT NULL,
    byte_size bigint NOT NULL,
    sha256 text NOT NULL,
    validation_status text DEFAULT 'pending'::text NOT NULL,
    validation_report jsonb,
    validated_with_matter_id uuid,
    uploaded_by uuid NOT NULL,
    validated_by uuid,
    validated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    canceled_at timestamp with time zone,
    canceled_by uuid,
    CONSTRAINT document_template_versions_byte_size_check CHECK (((byte_size > 0) AND (byte_size <= 15728640))),
    CONSTRAINT document_template_versions_sha256_check CHECK ((sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT document_template_versions_validation_status_check CHECK ((validation_status = ANY (ARRAY['pending'::text, 'valid'::text, 'invalid'::text, 'canceled'::text])))
);


--
-- Name: document_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_id uuid NOT NULL,
    r2_key text NOT NULL,
    pdf_r2_key text,
    source text DEFAULT 'upload'::text NOT NULL,
    version_number integer DEFAULT 1 NOT NULL,
    filename text,
    file_type text,
    size_bytes bigint DEFAULT 0 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    CONSTRAINT document_versions_source_check CHECK ((source = ANY (ARRAY['upload'::text, 'generated'::text, 'assistant_edit'::text, 'user_upload'::text, 'user_accept'::text, 'user_reject'::text, 'converted_pdf'::text, 'word_addin'::text])))
);


--
-- Name: TABLE document_versions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.document_versions IS 'Immutable-ish DOCX/PDF revision history for matter_documents; current_version_id points here.';


--
-- Name: COLUMN document_versions.source; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.document_versions.source IS 'What produced these bytes: a file uploaded to the matter (upload), the document generator (generated), an assistant edit applied in the web app (assistant_edit), a file a person uploaded over an existing document (user_upload), accepting or rejecting a tracked change (user_accept, user_reject), a PDF conversion (converted_pdf), or a save from the Word add-in (word_addin).';


--
-- Name: draft_generation_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.draft_generation_runs (
    id uuid NOT NULL,
    matter_id uuid NOT NULL,
    created_by uuid NOT NULL,
    source_revision text NOT NULL,
    request_hash text NOT NULL,
    requested_documents text[] NOT NULL,
    status text NOT NULL,
    outcomes jsonb DEFAULT '[]'::jsonb NOT NULL,
    worker_token uuid NOT NULL,
    lease_expires_at timestamp with time zone NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT draft_generation_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'partial'::text, 'completed'::text, 'failed'::text])))
);


--
-- Name: draft_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.draft_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    design_sheet_id uuid,
    matter_id uuid,
    drafted_by uuid,
    sheet_version integer,
    documents_generated text[],
    missing_fields jsonb,
    doc_type text,
    model text,
    status text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: estate_clause_preview_evidence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.estate_clause_preview_evidence (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clause_id uuid NOT NULL,
    revision_id uuid NOT NULL,
    revision_content_hash text NOT NULL,
    template_snapshot_hash text NOT NULL,
    document_types text[] NOT NULL,
    dependency_revision_ids jsonb DEFAULT '{}'::jsonb NOT NULL,
    template_publication_revision_ids jsonb DEFAULT '{}'::jsonb NOT NULL,
    representative_matter_id uuid NOT NULL,
    validation_report jsonb NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT estate_clause_preview_eviden_template_publication_revisio_check CHECK ((jsonb_typeof(template_publication_revision_ids) = 'object'::text)),
    CONSTRAINT estate_clause_preview_evidence_dependency_revision_ids_check CHECK ((jsonb_typeof(dependency_revision_ids) = 'object'::text)),
    CONSTRAINT estate_clause_preview_evidence_document_types_check CHECK ((cardinality(document_types) > 0)),
    CONSTRAINT estate_clause_preview_evidence_revision_content_hash_check CHECK ((revision_content_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT estate_clause_preview_evidence_template_snapshot_hash_check CHECK ((template_snapshot_hash ~ '^[0-9a-f]{64}$'::text))
);


--
-- Name: estate_clause_publications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.estate_clause_publications (
    clause_id uuid NOT NULL,
    current_revision_id uuid NOT NULL,
    published_by uuid NOT NULL,
    published_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: estate_clause_review_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.estate_clause_review_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clause_id uuid NOT NULL,
    revision_id uuid NOT NULL,
    event_type text NOT NULL,
    actor_id uuid NOT NULL,
    comment text,
    validation_report jsonb,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT estate_clause_review_events_check CHECK (((event_type <> ALL (ARRAY['changes_requested'::text, 'retired'::text, 'publication_reverted'::text])) OR ((comment IS NOT NULL) AND (length(btrim(comment)) > 0)))),
    CONSTRAINT estate_clause_review_events_event_type_check CHECK ((event_type = ANY (ARRAY['submitted'::text, 'changes_requested'::text, 'approved'::text, 'published'::text, 'retired'::text, 'publication_reverted'::text])))
);


--
-- Name: estate_clause_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.estate_clause_revisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clause_id uuid NOT NULL,
    revision_number integer NOT NULL,
    clause_text text NOT NULL,
    required_fields text[] DEFAULT '{}'::text[] NOT NULL,
    nested_clause_keys text[] DEFAULT '{}'::text[] NOT NULL,
    condition_field text,
    content_hash text NOT NULL,
    change_summary text NOT NULL,
    validation_status text NOT NULL,
    validation_report jsonb NOT NULL,
    author_id uuid NOT NULL,
    base_published_revision_id uuid,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT estate_clause_revisions_change_summary_check CHECK ((length(btrim(change_summary)) > 0)),
    CONSTRAINT estate_clause_revisions_clause_text_check CHECK ((length(btrim(clause_text)) > 0)),
    CONSTRAINT estate_clause_revisions_content_hash_check CHECK ((content_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT estate_clause_revisions_revision_number_check CHECK ((revision_number > 0)),
    CONSTRAINT estate_clause_revisions_validation_status_check CHECK ((validation_status = ANY (ARRAY['valid'::text, 'invalid'::text])))
);


--
-- Name: estate_clause_working_drafts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.estate_clause_working_drafts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clause_id uuid NOT NULL,
    base_published_revision_id uuid,
    clause_text text NOT NULL,
    required_fields text[] DEFAULT '{}'::text[] NOT NULL,
    nested_clause_keys text[] DEFAULT '{}'::text[] NOT NULL,
    condition_field text,
    change_summary text NOT NULL,
    content_hash text NOT NULL,
    validation_status text DEFAULT 'invalid'::text NOT NULL,
    validation_report jsonb DEFAULT '{}'::jsonb NOT NULL,
    author_id uuid NOT NULL,
    source_review_revision_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT estate_clause_working_drafts_change_summary_check CHECK ((length(btrim(change_summary)) > 0)),
    CONSTRAINT estate_clause_working_drafts_clause_text_check CHECK ((length(btrim(clause_text)) > 0)),
    CONSTRAINT estate_clause_working_drafts_content_hash_check CHECK ((content_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT estate_clause_working_drafts_validation_status_check CHECK ((validation_status = ANY (ARRAY['valid'::text, 'invalid'::text])))
);


--
-- Name: estate_clauses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.estate_clauses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clause_key text NOT NULL,
    title text NOT NULL,
    jurisdiction text DEFAULT 'MA'::text NOT NULL,
    document_types text[] NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT estate_clauses_clause_key_check CHECK ((length(btrim(clause_key)) > 0)),
    CONSTRAINT estate_clauses_document_types_check CHECK (((cardinality(document_types) > 0) AND (document_types <@ ARRAY['will'::text, 'trust'::text, 'durable_power_of_attorney'::text, 'health_care_directive'::text, 'hipaa_authorization'::text, 'ancillary'::text]))),
    CONSTRAINT estate_clauses_jurisdiction_check CHECK ((jurisdiction = 'MA'::text)),
    CONSTRAINT estate_clauses_title_check CHECK ((length(btrim(title)) > 0))
);


--
-- Name: generated_document_clause_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.generated_document_clause_revisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_version_id uuid NOT NULL,
    clause_id uuid NOT NULL,
    revision_id uuid NOT NULL,
    clause_key text NOT NULL,
    content_hash text NOT NULL,
    included boolean NOT NULL,
    inclusion_position integer,
    selection_reason text NOT NULL,
    override_id uuid,
    override_action text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT generated_document_clause_revisions_check CHECK ((((selection_reason = 'template_rule'::text) AND (override_id IS NULL) AND (override_action IS NULL) AND included) OR ((selection_reason = 'attorney_override'::text) AND (override_id IS NOT NULL) AND (override_action IS NOT NULL)))),
    CONSTRAINT generated_document_clause_revisions_check1 CHECK (((included AND (inclusion_position IS NOT NULL)) OR ((NOT included) AND (inclusion_position IS NULL)))),
    CONSTRAINT generated_document_clause_revisions_content_hash_check CHECK ((content_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT generated_document_clause_revisions_inclusion_position_check CHECK ((inclusion_position >= 0)),
    CONSTRAINT generated_document_clause_revisions_override_action_check CHECK ((override_action = ANY (ARRAY['force_include'::text, 'force_omit'::text]))),
    CONSTRAINT generated_document_clause_revisions_selection_reason_check CHECK ((selection_reason = ANY (ARRAY['template_rule'::text, 'attorney_override'::text])))
);


--
-- Name: matter_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.matter_details (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid NOT NULL,
    practice_area text,
    referral_source text,
    flat_fee_amount numeric,
    open_date date,
    client_status text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    matter_number text,
    plan_type text,
    matter_status text,
    jurisdiction_state text DEFAULT 'MA'::text,
    jurisdiction_county text,
    responsible_attorney text,
    co_counsel text,
    paralegal_assigned text,
    legal_plan text,
    legal_plan_id text,
    legal_plan_type text,
    target_close_date date,
    closed_date date,
    scheduled_signing_date timestamp with time zone,
    signing_date date,
    documents_filed_date date,
    est_estate_value numeric,
    tax_exposure text,
    internal_notes text,
    matter_status_notes text,
    pb_decedent_name text,
    pb_court_name text,
    pb_probate_type text,
    lawmatics_id text,
    conflict_cleared boolean,
    engagement_signed boolean,
    legal_plan_service_start date,
    legal_plan_service_end date,
    pb_inventory_due_date date,
    engagement_provider text,
    engagement_envelope_id text,
    engagement_status text,
    engagement_sent_at timestamp with time zone,
    engagement_signed_at timestamp with time zone,
    fee_payment_status text DEFAULT 'unpaid'::text NOT NULL,
    urgency text,
    billing_type text,
    iolta_required boolean,
    fee_collected boolean,
    fee_collected_date date,
    intake_date date,
    hired_date date,
    design_meeting_date date,
    draft_sent_date date,
    drafts_approved_date date,
    client_review_date date,
    revisions_sent_date date,
    execution_date date,
    trust_type text,
    credit_shelter_provisions text,
    trust_funding_status text,
    deed_recorded boolean,
    ep_plan_category text,
    ep_trust_type text,
    ep_funding_status text,
    ep_deed_transfers_needed boolean,
    ep_beneficiary_updates_needed boolean,
    ep_powers_of_attorney_status text,
    ep_healthcare_proxy_status text,
    ep_has_prenuptial boolean,
    ep_prior_plan_date date,
    ep_prior_plan_firm text,
    ep_special_provisions text,
    ep_signing_method text,
    ep_ma_estate_taxable boolean,
    ep_ma_estate_tax_savings numeric,
    ep_separate_trusts boolean,
    ep_has_ilit boolean,
    pb_date_of_death date,
    pb_testate_intestate text,
    pb_docket_number text,
    pb_personal_representative text,
    pb_surviving_spouse boolean,
    pb_surviving_spouse_name text,
    pb_elective_share_claimed boolean,
    pb_has_minor_beneficiaries boolean,
    pb_qualifies_small_estate boolean,
    pb_ancillary_probate_required boolean,
    pb_ancillary_probate_state text,
    pb_bond_waived_in_will boolean,
    pb_federal_estate_tax_required boolean,
    pb_state_estate_tax_required boolean,
    pb_estate_closed boolean,
    referral_source_other text,
    ep_has_real_estate boolean DEFAULT false,
    ep_has_pets boolean DEFAULT false,
    ep_anticipated_inheritance boolean DEFAULT false,
    ep_accounts_retitled boolean DEFAULT false,
    legal_plan_member_id text,
    claim_amount numeric,
    claim_submitted_date date,
    reimbursement_received_date date,
    payment_link_sent_at timestamp with time zone,
    work_started_date date,
    work_finished_date date,
    closing_package_sent_date date,
    next_action_date date,
    matter_type text,
    clio_matter_number text,
    ep_ancillary_docs jsonb DEFAULT '[]'::jsonb,
    ep_living_will_status text,
    ep_hipaa_auth_status text,
    ep_witness_required boolean DEFAULT false,
    ep_funding_complete_date date,
    ep_ilit_trustee text,
    conflict_check_completed boolean DEFAULT false,
    conflict_check_date date,
    pb_pr_appointment_date date,
    pb_inventory_filed_date date,
    pb_claims_period_end_date date,
    pb_706_due_date date,
    pb_706_filed_date date,
    pb_m706_due_date date,
    pb_m706_filed_date date,
    pb_fiduciary_return_due_date date,
    pb_fiduciary_return_filed_date date,
    pb_final_distribution_date date,
    pb_estimated_close_date date,
    pb_estate_closed_date date,
    pb_bond_amount numeric,
    pb_beneficiary_count integer,
    pb_heir_count integer,
    pb_real_property_parcel_count integer,
    fee_quoted_date date,
    optional_services jsonb,
    annual_review_opt_out boolean DEFAULT false NOT NULL,
    retention_until date,
    retention_hold boolean DEFAULT false NOT NULL,
    retention_hold_reason text,
    pb_letters_issued_date date,
    pb_petition_filed_date date,
    CONSTRAINT matter_details_billing_type_check CHECK (((billing_type IS NULL) OR (billing_type = ANY (ARRAY['flat_fee'::text, 'metlife'::text, 'legalease'::text, 'arag'::text, 'clc'::text, 'other_legal_plan'::text])))),
    CONSTRAINT matter_details_fee_payment_status_check CHECK ((fee_payment_status = ANY (ARRAY['unpaid'::text, 'deposit'::text, 'paid_in_full'::text]))),
    CONSTRAINT matter_details_optional_services_is_array CHECK (((optional_services IS NULL) OR (jsonb_typeof(optional_services) = 'array'::text))),
    CONSTRAINT matter_details_practice_area_check CHECK (((practice_area IS NULL) OR (practice_area = ANY (ARRAY['EP'::text, 'EP-LP'::text, 'CP'::text, 'Probate'::text, 'TA'::text])))),
    CONSTRAINT matter_details_urgency_check CHECK (((urgency IS NULL) OR (urgency = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text]))))
);


--
-- Name: COLUMN matter_details.claim_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.matter_details.claim_amount IS 'What the plan is expected to pay. Flat-fee matters leave this null.';


--
-- Name: COLUMN matter_details.next_action_date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.matter_details.next_action_date IS 'Drives the header pill and the weekly ops board.';


--
-- Name: COLUMN matter_details.matter_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.matter_details.matter_type IS 'individual | couple — gates the spouse surfaces, joint trusts and second-death provisions (lib/matter/matterType.ts). Falls back to marital status when null.';


--
-- Name: COLUMN matter_details.ep_ancillary_docs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.matter_details.ep_ancillary_docs IS 'JSON array of ancillary document tracking objects: { "doc_type": string, "status": string, "notes": string }.';


--
-- Name: COLUMN matter_details.pb_bond_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.matter_details.pb_bond_amount IS 'Dollar amount of the surety bond required by the court.';


--
-- Name: COLUMN matter_details.retention_until; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.matter_details.retention_until IS 'The day the retention period ends: closed_date plus the firm''s retention years, set when the matter closes. A weekly run lists files past this date for review; nothing is destroyed automatically.';


--
-- Name: COLUMN matter_details.retention_hold; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.matter_details.retention_hold IS 'True while the file must be kept past its retention date (a dispute, a request, an open estate). A held file is never listed for destruction.';


--
-- Name: matter_document_folders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.matter_document_folders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    matter_id uuid NOT NULL,
    name text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    parent_id uuid,
    CONSTRAINT matter_document_folders_name_check CHECK ((length(btrim(name)) > 0)),
    CONSTRAINT matter_document_folders_not_own_parent CHECK (((parent_id IS NULL) OR (parent_id <> id)))
);


--
-- Name: TABLE matter_document_folders; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.matter_document_folders IS 'Attorney-named folders for a matter''s documents. Derived folders (client uploads, executed, generated drafts) are computed in lib/documentWorkspace.ts and are not stored here.';


--
-- Name: COLUMN matter_document_folders.parent_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.matter_document_folders.parent_id IS 'The folder this one sits inside, or NULL for the root of the matter''s workspace.';


--
-- Name: matter_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.matter_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    matter_id text NOT NULL,
    r2_key text NOT NULL,
    name text NOT NULL,
    size bigint DEFAULT 0 NOT NULL,
    content_type text DEFAULT 'application/octet-stream'::text NOT NULL,
    uploaded_by uuid,
    generation_id uuid,
    generation_engine text,
    marker_count integer,
    missing_count integer,
    superseded_at timestamp with time zone,
    reviewed_at timestamp with time zone,
    reviewed_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    current_version_id uuid,
    template_id text,
    template_version_id uuid,
    shared_at timestamp with time zone,
    source text DEFAULT 'firm'::text NOT NULL,
    draft_run_output text,
    folder_id uuid,
    document_kind text,
    CONSTRAINT matter_documents_document_kind_check CHECK (((document_kind IS NULL) OR (document_kind = ANY (ARRAY['will'::text, 'trust'::text, 'dpoa'::text, 'health_care_proxy'::text, 'hipaa_authorization'::text, 'advance_directive'::text, 'deed'::text, 'homestead_declaration'::text, 'certificate_of_trust'::text, 'assignment_of_personal_property'::text, 'personal_property_memorandum'::text, 'parental_guardian_appointment'::text, 'other'::text])))),
    CONSTRAINT matter_documents_generation_engine_check CHECK (((generation_engine IS NULL) OR (generation_engine = ANY (ARRAY['node'::text, 'supabase'::text, 'llm_fallback'::text, 'python_fallback'::text])))),
    CONSTRAINT matter_documents_source_check CHECK ((source = ANY (ARRAY['firm'::text, 'client'::text, 'meeting-notes'::text])))
);


--
-- Name: COLUMN matter_documents.document_kind; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.matter_documents.document_kind IS 'The execution kind the generator recorded (lib/execution/requirements.ts), or other for a document nobody signs. Null means unknown: fall back to the filename.';


--
-- Name: matter_estate_clause_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.matter_estate_clause_overrides (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    matter_id uuid NOT NULL,
    clause_id uuid NOT NULL,
    publication_revision_id uuid NOT NULL,
    event_type text NOT NULL,
    action text,
    reason text NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    supersedes_override_id uuid,
    CONSTRAINT matter_estate_clause_overrides_action_check CHECK ((action = ANY (ARRAY['force_include'::text, 'force_omit'::text]))),
    CONSTRAINT matter_estate_clause_overrides_check CHECK ((((event_type = 'applied'::text) AND (action IS NOT NULL)) OR ((event_type = 'retired'::text) AND (action IS NULL)))),
    CONSTRAINT matter_estate_clause_overrides_event_type_check CHECK ((event_type = ANY (ARRAY['applied'::text, 'retired'::text]))),
    CONSTRAINT matter_estate_clause_overrides_reason_check CHECK ((length(btrim(reason)) >= 10))
);


--
-- Name: rate_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rate_limits (
    bucket text NOT NULL,
    key text NOT NULL,
    window_start timestamp with time zone NOT NULL,
    count integer DEFAULT 0 NOT NULL
);


--
-- Name: style_sets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.style_sets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    source_file_name text,
    source_r2_key text,
    source_size_bytes bigint,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: TABLE style_sets; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.style_sets IS 'Reusable document formatting. `settings` is parsed by parseStyleSetSettings() in lib/styleSets/schema.ts and applied by applyStyleSetToPart() at generation time.';


--
-- Name: COLUMN style_sets.settings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.style_sets.settings IS 'StyleSetSettings as JSON. Absent keys mean "preserve the template''s own value", so older rows stay valid as the schema grows.';


--
-- Name: COLUMN style_sets.deleted_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.style_sets.deleted_at IS 'Soft delete. A generated document records which style set produced it, so a hard delete would strip the provenance from work already delivered.';


--
-- Name: user_api_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_api_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    provider text NOT NULL,
    encrypted_key text NOT NULL,
    iv text NOT NULL,
    auth_tag text NOT NULL,
    key_hint text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_api_keys_provider_check CHECK ((provider = ANY (ARRAY['anthropic'::text, 'openai'::text, 'gemini'::text])))
);


--
-- Name: TABLE user_api_keys; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_api_keys IS 'Staff BYOK provider keys; ciphertext only. Decrypted server-side with USER_API_KEYS_ENCRYPTION_SECRET.';


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid NOT NULL,
    email text,
    display_name text,
    role text DEFAULT 'client'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    preferences jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT users_role_check CHECK ((role = ANY (ARRAY['client'::text, 'attorney'::text, 'admin'::text, 'va'::text, 'staff'::text])))
);


--
-- Name: COLUMN users.preferences; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.preferences IS 'Staff UI preferences keyed by app area, e.g. {"drafting":{"designView":"guided"}}';


--
-- Name: v_matter_pipeline; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_matter_pipeline WITH (security_invoker='true') AS
 SELECT m.id AS matter_id,
    m.name AS matter_name,
    m.stage,
    m.status,
    m.flags,
    m.created_at AS matter_created,
    TRIM(BOTH FROM concat_ws(' '::text, ci.first_name, ci.last_name)) AS client_name,
    ci.email AS client_email,
    ci.phone AS client_phone,
    ci.date_of_birth AS client_dob,
    NULLIF(concat_ws(', '::text, NULLIF(TRIM(BOTH FROM concat_ws(' '::text, ci.address_line1, ci.address_line2)), ''::text), NULLIF(ci.city, ''::text), NULLIF(TRIM(BOTH FROM concat_ws(' '::text, ci.state, ci.zip)), ''::text)), ''::text) AS client_address,
    NULLIF(TRIM(BOTH FROM concat_ws(' '::text, cs.first_name, cs.last_name)), ''::text) AS spouse_name,
    cs.email AS spouse_email,
    cs.phone AS spouse_phone,
    cs.date_of_birth AS spouse_dob,
    COALESCE(NULLIF(concat_ws(', '::text, NULLIF(TRIM(BOTH FROM concat_ws(' '::text, cs.address_line1, cs.address_line2)), ''::text), NULLIF(cs.city, ''::text), NULLIF(TRIM(BOTH FROM concat_ws(' '::text, cs.state, cs.zip)), ''::text)), ''::text), NULLIF(concat_ws(', '::text, NULLIF(TRIM(BOTH FROM concat_ws(' '::text, ci.address_line1, ci.address_line2)), ''::text), NULLIF(ci.city, ''::text), NULLIF(TRIM(BOTH FROM concat_ws(' '::text, ci.state, ci.zip)), ''::text)), ''::text)) AS spouse_address,
    ci.plan_type,
    ci.marital_status,
    ci.has_minor_children,
    ci.taxable_estate,
    ci.status AS intake_status,
    ci.intake_sent_at,
    ds.status AS design_status,
    m.intake_submitted_at,
    m.drafts_sent_at,
    m.signing_date,
    m.documents_executed_at,
    NULL::timestamp with time zone AS next_appointment,
    NULL::text AS next_appointment_type,
    md.practice_area,
    md.referral_source,
    md.flat_fee_amount AS fee_amount,
    (md.open_date)::timestamp with time zone AS opened_at,
    md.client_status
   FROM ((((public.matters m
     JOIN public.client_intake ci ON ((ci.id = m.client_intake_id)))
     LEFT JOIN public.contacts cs ON (((cs.client_intake_id = ci.id) AND (cs.relationship_type = 'spouse'::text))))
     LEFT JOIN LATERAL ( SELECT inner_ds.status
           FROM public.design_sheets inner_ds
          WHERE (inner_ds.matter_id = m.id)
          ORDER BY inner_ds.version DESC
         LIMIT 1) ds ON (true))
     LEFT JOIN public.matter_details md ON ((md.client_id = m.id)))
  WHERE ((m.status <> 'archived'::text) AND (m.relationship_status = 'hired'::text));


--
-- Name: ai_usage ai_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage
    ADD CONSTRAINT ai_usage_pkey PRIMARY KEY (id);


--
-- Name: client_intake client_intake_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_intake
    ADD CONSTRAINT client_intake_pkey PRIMARY KEY (id);


--
-- Name: contact_roles contact_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_roles
    ADD CONSTRAINT contact_roles_pkey PRIMARY KEY (id);


--
-- Name: contacts contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_pkey PRIMARY KEY (id);


--
-- Name: custom_document_templates custom_document_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_document_templates
    ADD CONSTRAINT custom_document_templates_pkey PRIMARY KEY (id);


--
-- Name: custom_document_templates custom_document_templates_storage_path_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_document_templates
    ADD CONSTRAINT custom_document_templates_storage_path_key UNIQUE (storage_path);


--
-- Name: design_sheets design_sheets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.design_sheets
    ADD CONSTRAINT design_sheets_pkey PRIMARY KEY (id);


--
-- Name: doc_selections doc_selections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doc_selections
    ADD CONSTRAINT doc_selections_pkey PRIMARY KEY (id);


--
-- Name: document_access_audit document_access_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_access_audit
    ADD CONSTRAINT document_access_audit_pkey PRIMARY KEY (id);


--
-- Name: document_template_events document_template_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_template_events
    ADD CONSTRAINT document_template_events_pkey PRIMARY KEY (id);


--
-- Name: document_template_publications document_template_publications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_template_publications
    ADD CONSTRAINT document_template_publications_pkey PRIMARY KEY (template_id);


--
-- Name: document_template_versions document_template_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_template_versions
    ADD CONSTRAINT document_template_versions_pkey PRIMARY KEY (id);


--
-- Name: document_template_versions document_template_versions_storage_path_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_template_versions
    ADD CONSTRAINT document_template_versions_storage_path_key UNIQUE (storage_path);


--
-- Name: document_versions document_versions_document_id_version_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_versions
    ADD CONSTRAINT document_versions_document_id_version_number_key UNIQUE (document_id, version_number);


--
-- Name: document_versions document_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_versions
    ADD CONSTRAINT document_versions_pkey PRIMARY KEY (id);


--
-- Name: draft_generation_runs draft_generation_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.draft_generation_runs
    ADD CONSTRAINT draft_generation_runs_pkey PRIMARY KEY (id);


--
-- Name: draft_log draft_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.draft_log
    ADD CONSTRAINT draft_log_pkey PRIMARY KEY (id);


--
-- Name: estate_clause_preview_evidence estate_clause_preview_evidence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estate_clause_preview_evidence
    ADD CONSTRAINT estate_clause_preview_evidence_pkey PRIMARY KEY (id);


--
-- Name: estate_clause_publications estate_clause_publications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estate_clause_publications
    ADD CONSTRAINT estate_clause_publications_pkey PRIMARY KEY (clause_id);


--
-- Name: estate_clause_review_events estate_clause_review_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estate_clause_review_events
    ADD CONSTRAINT estate_clause_review_events_pkey PRIMARY KEY (id);


--
-- Name: estate_clause_revisions estate_clause_revisions_clause_id_revision_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estate_clause_revisions
    ADD CONSTRAINT estate_clause_revisions_clause_id_revision_number_key UNIQUE (clause_id, revision_number);


--
-- Name: estate_clause_revisions estate_clause_revisions_id_clause_id_content_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estate_clause_revisions
    ADD CONSTRAINT estate_clause_revisions_id_clause_id_content_hash_key UNIQUE (id, clause_id, content_hash);


--
-- Name: estate_clause_revisions estate_clause_revisions_id_clause_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estate_clause_revisions
    ADD CONSTRAINT estate_clause_revisions_id_clause_id_key UNIQUE (id, clause_id);


--
-- Name: estate_clause_revisions estate_clause_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estate_clause_revisions
    ADD CONSTRAINT estate_clause_revisions_pkey PRIMARY KEY (id);


--
-- Name: estate_clause_working_drafts estate_clause_working_drafts_clause_id_author_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estate_clause_working_drafts
    ADD CONSTRAINT estate_clause_working_drafts_clause_id_author_id_key UNIQUE (clause_id, author_id);


--
-- Name: estate_clause_working_drafts estate_clause_working_drafts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estate_clause_working_drafts
    ADD CONSTRAINT estate_clause_working_drafts_pkey PRIMARY KEY (id);


--
-- Name: estate_clauses estate_clauses_clause_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estate_clauses
    ADD CONSTRAINT estate_clauses_clause_key_key UNIQUE (clause_key);


--
-- Name: estate_clauses estate_clauses_id_clause_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estate_clauses
    ADD CONSTRAINT estate_clauses_id_clause_key_key UNIQUE (id, clause_key);


--
-- Name: estate_clauses estate_clauses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estate_clauses
    ADD CONSTRAINT estate_clauses_pkey PRIMARY KEY (id);


--
-- Name: generated_document_clause_revisions generated_document_clause_rev_document_version_id_clause_ke_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_document_clause_revisions
    ADD CONSTRAINT generated_document_clause_rev_document_version_id_clause_ke_key UNIQUE (document_version_id, clause_key);


--
-- Name: generated_document_clause_revisions generated_document_clause_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_document_clause_revisions
    ADD CONSTRAINT generated_document_clause_revisions_pkey PRIMARY KEY (id);


--
-- Name: matter_contacts matter_contacts_matter_id_contact_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matter_contacts
    ADD CONSTRAINT matter_contacts_matter_id_contact_id_key UNIQUE (matter_id, contact_id);


--
-- Name: matter_contacts matter_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matter_contacts
    ADD CONSTRAINT matter_contacts_pkey PRIMARY KEY (id);


--
-- Name: matter_details matter_details_client_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matter_details
    ADD CONSTRAINT matter_details_client_id_key UNIQUE (client_id);


--
-- Name: matter_details matter_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matter_details
    ADD CONSTRAINT matter_details_pkey PRIMARY KEY (id);


--
-- Name: matter_document_folders matter_document_folders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matter_document_folders
    ADD CONSTRAINT matter_document_folders_pkey PRIMARY KEY (id);


--
-- Name: matter_documents matter_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matter_documents
    ADD CONSTRAINT matter_documents_pkey PRIMARY KEY (id);


--
-- Name: matter_documents matter_documents_r2_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matter_documents
    ADD CONSTRAINT matter_documents_r2_key_key UNIQUE (r2_key);


--
-- Name: matter_estate_clause_overrides matter_estate_clause_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matter_estate_clause_overrides
    ADD CONSTRAINT matter_estate_clause_overrides_pkey PRIMARY KEY (id);


--
-- Name: matters matters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matters
    ADD CONSTRAINT matters_pkey PRIMARY KEY (id);


--
-- Name: rate_limits rate_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limits
    ADD CONSTRAINT rate_limits_pkey PRIMARY KEY (bucket, key, window_start);


--
-- Name: style_sets style_sets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.style_sets
    ADD CONSTRAINT style_sets_pkey PRIMARY KEY (id);


--
-- Name: user_api_keys user_api_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_api_keys
    ADD CONSTRAINT user_api_keys_pkey PRIMARY KEY (id);


--
-- Name: user_api_keys user_api_keys_user_id_provider_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_api_keys
    ADD CONSTRAINT user_api_keys_user_id_provider_key UNIQUE (user_id, provider);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: ai_usage_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_usage_created_at_idx ON public.ai_usage USING btree (created_at DESC);


--
-- Name: ai_usage_workflow_run_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_usage_workflow_run_idx ON public.ai_usage USING btree (workflow_run_id) WHERE (workflow_run_id IS NOT NULL);


--
-- Name: client_intake_active_link_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_intake_active_link_idx ON public.client_intake USING btree (id, intake_link_version) WHERE ((intake_link_version IS NOT NULL) AND (intake_link_revoked_at IS NULL));


--
-- Name: client_intake_engagement_envelope_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX client_intake_engagement_envelope_id_idx ON public.client_intake USING btree (engagement_envelope_id) WHERE (engagement_envelope_id IS NOT NULL);


--
-- Name: client_intake_intake_token_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX client_intake_intake_token_hash_idx ON public.client_intake USING btree (intake_token_hash) WHERE (intake_token_hash IS NOT NULL);


--
-- Name: client_intake_lawmatics_matter_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX client_intake_lawmatics_matter_id_key ON public.client_intake USING btree (lawmatics_matter_id);


--
-- Name: client_intake_lead_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX client_intake_lead_status_idx ON public.client_intake USING btree (lead_status) WHERE (lead_status IS NOT NULL);


--
-- Name: contact_roles_matter_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contact_roles_matter_idx ON public.contact_roles USING btree (matter_id);


--
-- Name: contacts_lawmatics_contact_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX contacts_lawmatics_contact_id_key ON public.contacts USING btree (lawmatics_contact_id) WHERE (lawmatics_contact_id IS NOT NULL);


--
-- Name: contacts_merged_into_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contacts_merged_into_idx ON public.contacts USING btree (merged_into_id) WHERE (merged_into_id IS NOT NULL);


--
-- Name: custom_document_templates_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX custom_document_templates_active_idx ON public.custom_document_templates USING btree (created_at DESC) WHERE (archived_at IS NULL);


--
-- Name: design_sheets_matter_id_version_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX design_sheets_matter_id_version_key ON public.design_sheets USING btree (matter_id, version);


--
-- Name: document_template_events_template_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_template_events_template_idx ON public.document_template_events USING btree (template_id, created_at DESC);


--
-- Name: document_template_versions_live_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX document_template_versions_live_hash_idx ON public.document_template_versions USING btree (template_id, sha256) WHERE (validation_status <> 'canceled'::text);


--
-- Name: document_template_versions_template_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_template_versions_template_idx ON public.document_template_versions USING btree (template_id, created_at DESC);


--
-- Name: draft_generation_runs_matter_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX draft_generation_runs_matter_created ON public.draft_generation_runs USING btree (matter_id, created_at DESC);


--
-- Name: draft_run_output_identity; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX draft_run_output_identity ON public.matter_documents USING btree (generation_id, draft_run_output) WHERE (draft_run_output IS NOT NULL);


--
-- Name: draft_runs_feed_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX draft_runs_feed_order ON public.draft_generation_runs USING btree (created_at DESC, id DESC);


--
-- Name: estate_clause_review_events_revision_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX estate_clause_review_events_revision_idx ON public.estate_clause_review_events USING btree (revision_id, created_at DESC);


--
-- Name: estate_clause_revisions_clause_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX estate_clause_revisions_clause_idx ON public.estate_clause_revisions USING btree (clause_id, revision_number DESC);


--
-- Name: generated_document_clause_revisions_document_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX generated_document_clause_revisions_document_idx ON public.generated_document_clause_revisions USING btree (document_version_id);


--
-- Name: generated_document_clause_revisions_position_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX generated_document_clause_revisions_position_idx ON public.generated_document_clause_revisions USING btree (document_version_id, inclusion_position) WHERE included;


--
-- Name: generated_document_clause_revisions_revision_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX generated_document_clause_revisions_revision_idx ON public.generated_document_clause_revisions USING btree (revision_id);


--
-- Name: idx_client_intake_client_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_client_intake_client_user ON public.client_intake USING btree (client_user_id);


--
-- Name: idx_client_intake_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_client_intake_email ON public.client_intake USING btree (email);


--
-- Name: idx_client_intake_matter; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_client_intake_matter ON public.client_intake USING btree (matter_id);


--
-- Name: idx_contact_roles_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contact_roles_contact ON public.contact_roles USING btree (contact_id);


--
-- Name: idx_contact_roles_intake; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contact_roles_intake ON public.contact_roles USING btree (client_intake_id) WHERE (client_intake_id IS NOT NULL);


--
-- Name: idx_contacts_intake; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_intake ON public.contacts USING btree (client_intake_id);


--
-- Name: idx_design_sheets_matter; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_design_sheets_matter ON public.design_sheets USING btree (matter_id);


--
-- Name: idx_doc_selections_sheet; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_doc_selections_sheet ON public.doc_selections USING btree (design_sheet_id);


--
-- Name: idx_document_access_audit_document; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_document_access_audit_document ON public.document_access_audit USING btree (document_id, created_at DESC);


--
-- Name: idx_document_access_audit_matter; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_document_access_audit_matter ON public.document_access_audit USING btree (matter_id, created_at DESC);


--
-- Name: idx_document_versions_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_document_versions_active ON public.document_versions USING btree (document_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_document_versions_document; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_document_versions_document ON public.document_versions USING btree (document_id, version_number DESC);


--
-- Name: idx_draft_log_matter; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_draft_log_matter ON public.draft_log USING btree (matter_id);


--
-- Name: idx_draft_log_sheet; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_draft_log_sheet ON public.draft_log USING btree (design_sheet_id);


--
-- Name: idx_matter_details_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_matter_details_client ON public.matter_details USING btree (client_id);


--
-- Name: idx_matter_docs_generation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_matter_docs_generation ON public.matter_documents USING btree (matter_id, generation_id);


--
-- Name: idx_matter_docs_matter; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_matter_docs_matter ON public.matter_documents USING btree (matter_id);


--
-- Name: idx_matters_client_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_matters_client_id ON public.matters USING btree (client_id);


--
-- Name: idx_matters_client_intake; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_matters_client_intake ON public.matters USING btree (client_intake_id);


--
-- Name: idx_matters_matter_number; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_matters_matter_number ON public.matters USING btree (matter_number) WHERE (matter_number IS NOT NULL);


--
-- Name: idx_rate_limits_window_start; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rate_limits_window_start ON public.rate_limits USING btree (window_start);


--
-- Name: idx_user_api_keys_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_api_keys_user ON public.user_api_keys USING btree (user_id);


--
-- Name: matter_contacts_contact_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX matter_contacts_contact_idx ON public.matter_contacts USING btree (contact_id);


--
-- Name: matter_contacts_one_self; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX matter_contacts_one_self ON public.matter_contacts USING btree (matter_id) WHERE (relationship_type = 'self'::text);


--
-- Name: matter_contacts_one_spouse; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX matter_contacts_one_spouse ON public.matter_contacts USING btree (matter_id) WHERE (relationship_type = 'spouse'::text);


--
-- Name: matter_details_engagement_envelope_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX matter_details_engagement_envelope_id_idx ON public.matter_details USING btree (engagement_envelope_id) WHERE (engagement_envelope_id IS NOT NULL);


--
-- Name: matter_details_retention_until_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX matter_details_retention_until_idx ON public.matter_details USING btree (retention_until) WHERE (retention_until IS NOT NULL);


--
-- Name: matter_document_folders_matter_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX matter_document_folders_matter_idx ON public.matter_document_folders USING btree (matter_id, created_at);


--
-- Name: matter_document_folders_parent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX matter_document_folders_parent_idx ON public.matter_document_folders USING btree (parent_id) WHERE (parent_id IS NOT NULL);


--
-- Name: matter_document_folders_unique_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX matter_document_folders_unique_name ON public.matter_document_folders USING btree (matter_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)));


--
-- Name: matter_documents_folder_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX matter_documents_folder_idx ON public.matter_documents USING btree (folder_id) WHERE (folder_id IS NOT NULL);


--
-- Name: matter_documents_matter_shared_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX matter_documents_matter_shared_idx ON public.matter_documents USING btree (matter_id, shared_at);


--
-- Name: matter_documents_matter_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX matter_documents_matter_source_idx ON public.matter_documents USING btree (matter_id, source);


--
-- Name: matter_estate_clause_overrides_matter_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX matter_estate_clause_overrides_matter_idx ON public.matter_estate_clause_overrides USING btree (matter_id);


--
-- Name: matters_creation_request_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX matters_creation_request_id_key ON public.matters USING btree (creation_request_id) WHERE (creation_request_id IS NOT NULL);


--
-- Name: matters_discovery_call_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX matters_discovery_call_idx ON public.matters USING btree (discovery_call_at DESC) WHERE (relationship_status = 'lead'::text);


--
-- Name: matters_merged_into_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX matters_merged_into_idx ON public.matters USING btree (merged_into_id) WHERE (merged_into_id IS NOT NULL);


--
-- Name: matters_relationship_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX matters_relationship_status_idx ON public.matters USING btree (relationship_status, status, created_at DESC);


--
-- Name: style_sets_live; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX style_sets_live ON public.style_sets USING btree (updated_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: style_sets_name_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX style_sets_name_unique ON public.style_sets USING btree (lower(name)) WHERE (deleted_at IS NULL);


--
-- Name: style_sets_one_default; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX style_sets_one_default ON public.style_sets USING btree (is_default) WHERE (is_default AND (deleted_at IS NULL));


--
-- Name: uq_contacts_one_spouse; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_contacts_one_spouse ON public.contacts USING btree (client_intake_id) WHERE (relationship_type = 'spouse'::text);


--
-- Name: estate_clauses estate_clause_key_stable_after_use; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER estate_clause_key_stable_after_use BEFORE UPDATE OF clause_key ON public.estate_clauses FOR EACH ROW EXECUTE FUNCTION public.prevent_used_estate_clause_key_change();


--
-- Name: estate_clause_preview_evidence estate_clause_preview_evidence_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER estate_clause_preview_evidence_immutable BEFORE DELETE OR UPDATE ON public.estate_clause_preview_evidence FOR EACH ROW EXECUTE FUNCTION public.prevent_estate_clause_revision_mutation();


--
-- Name: estate_clause_publications estate_clause_publications_serialized; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER estate_clause_publications_serialized BEFORE INSERT OR DELETE OR UPDATE ON public.estate_clause_publications FOR EACH STATEMENT EXECUTE FUNCTION public.lock_estate_clause_publication_changes();


--
-- Name: estate_clause_review_events estate_clause_review_events_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER estate_clause_review_events_immutable BEFORE DELETE OR UPDATE ON public.estate_clause_review_events FOR EACH ROW EXECUTE FUNCTION public.prevent_estate_clause_revision_mutation();


--
-- Name: estate_clause_revisions estate_clause_revisions_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER estate_clause_revisions_immutable BEFORE DELETE OR UPDATE ON public.estate_clause_revisions FOR EACH ROW EXECUTE FUNCTION public.prevent_estate_clause_revision_mutation();


--
-- Name: document_template_publications estate_template_publications_serialized; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER estate_template_publications_serialized BEFORE INSERT OR DELETE OR UPDATE ON public.document_template_publications FOR EACH STATEMENT EXECUTE FUNCTION public.lock_estate_template_publication_changes();


--
-- Name: matter_documents file_generated_draft_into_drafts_folder; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER file_generated_draft_into_drafts_folder BEFORE INSERT ON public.matter_documents FOR EACH ROW EXECUTE FUNCTION public.file_generated_draft_into_drafts_folder();


--
-- Name: generated_document_clause_revisions generated_document_clause_revisions_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER generated_document_clause_revisions_immutable BEFORE DELETE OR UPDATE ON public.generated_document_clause_revisions FOR EACH ROW EXECUTE FUNCTION public.prevent_estate_clause_revision_mutation();


--
-- Name: matter_documents guard_draft_run_output; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER guard_draft_run_output BEFORE INSERT ON public.matter_documents FOR EACH ROW EXECUTE FUNCTION public.guard_draft_run_output();


--
-- Name: matter_estate_clause_overrides matter_estate_clause_overrides_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER matter_estate_clause_overrides_immutable BEFORE DELETE OR UPDATE ON public.matter_estate_clause_overrides FOR EACH ROW EXECUTE FUNCTION public.prevent_estate_clause_revision_mutation();


--
-- Name: matter_contacts set_updated_at_matter_contacts; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at_matter_contacts BEFORE UPDATE ON public.matter_contacts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: matter_document_folders set_updated_at_matter_document_folders; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at_matter_document_folders BEFORE UPDATE ON public.matter_document_folders FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: style_sets set_updated_at_style_sets; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at_style_sets BEFORE UPDATE ON public.style_sets FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: ai_usage ai_usage_matter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage
    ADD CONSTRAINT ai_usage_matter_id_fkey FOREIGN KEY (matter_id) REFERENCES public.matters(id) ON DELETE SET NULL;


--
-- Name: ai_usage ai_usage_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage
    ADD CONSTRAINT ai_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: client_intake client_intake_client_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_intake
    ADD CONSTRAINT client_intake_client_user_id_fkey FOREIGN KEY (client_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: client_intake client_intake_matter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_intake
    ADD CONSTRAINT client_intake_matter_id_fkey FOREIGN KEY (matter_id) REFERENCES public.matters(id) ON DELETE SET NULL;


--
-- Name: client_intake client_intake_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_intake
    ADD CONSTRAINT client_intake_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: contact_roles contact_roles_client_intake_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_roles
    ADD CONSTRAINT contact_roles_client_intake_id_fkey FOREIGN KEY (client_intake_id) REFERENCES public.client_intake(id) ON DELETE CASCADE;


--
-- Name: contact_roles contact_roles_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_roles
    ADD CONSTRAINT contact_roles_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;


--
-- Name: contact_roles contact_roles_matter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_roles
    ADD CONSTRAINT contact_roles_matter_id_fkey FOREIGN KEY (matter_id) REFERENCES public.matters(id) ON DELETE CASCADE;


--
-- Name: contacts contacts_client_intake_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_client_intake_id_fkey FOREIGN KEY (client_intake_id) REFERENCES public.client_intake(id) ON DELETE CASCADE;


--
-- Name: contacts contacts_merged_into_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_merged_into_id_fkey FOREIGN KEY (merged_into_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: custom_document_templates custom_document_templates_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_document_templates
    ADD CONSTRAINT custom_document_templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: design_sheets design_sheets_client_intake_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.design_sheets
    ADD CONSTRAINT design_sheets_client_intake_id_fkey FOREIGN KEY (client_intake_id) REFERENCES public.client_intake(id) ON DELETE SET NULL;


--
-- Name: design_sheets design_sheets_matter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.design_sheets
    ADD CONSTRAINT design_sheets_matter_id_fkey FOREIGN KEY (matter_id) REFERENCES public.matters(id) ON DELETE CASCADE;


--
-- Name: doc_selections doc_selections_design_sheet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.doc_selections
    ADD CONSTRAINT doc_selections_design_sheet_id_fkey FOREIGN KEY (design_sheet_id) REFERENCES public.design_sheets(id) ON DELETE CASCADE;


--
-- Name: document_access_audit document_access_audit_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_access_audit
    ADD CONSTRAINT document_access_audit_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.matter_documents(id) ON DELETE SET NULL;


--
-- Name: document_access_audit document_access_audit_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_access_audit
    ADD CONSTRAINT document_access_audit_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: document_template_events document_template_events_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_template_events
    ADD CONSTRAINT document_template_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id);


--
-- Name: document_template_events document_template_events_previous_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_template_events
    ADD CONSTRAINT document_template_events_previous_version_id_fkey FOREIGN KEY (previous_version_id) REFERENCES public.document_template_versions(id);


--
-- Name: document_template_events document_template_events_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_template_events
    ADD CONSTRAINT document_template_events_version_id_fkey FOREIGN KEY (version_id) REFERENCES public.document_template_versions(id);


--
-- Name: document_template_publications document_template_publications_published_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_template_publications
    ADD CONSTRAINT document_template_publications_published_by_fkey FOREIGN KEY (published_by) REFERENCES public.users(id);


--
-- Name: document_template_publications document_template_publications_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_template_publications
    ADD CONSTRAINT document_template_publications_version_id_fkey FOREIGN KEY (version_id) REFERENCES public.document_template_versions(id);


--
-- Name: document_template_versions document_template_versions_canceled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_template_versions
    ADD CONSTRAINT document_template_versions_canceled_by_fkey FOREIGN KEY (canceled_by) REFERENCES public.users(id);


--
-- Name: document_template_versions document_template_versions_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_template_versions
    ADD CONSTRAINT document_template_versions_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id);


--
-- Name: document_template_versions document_template_versions_validated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_template_versions
    ADD CONSTRAINT document_template_versions_validated_by_fkey FOREIGN KEY (validated_by) REFERENCES public.users(id);


--
-- Name: document_template_versions document_template_versions_validated_with_matter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_template_versions
    ADD CONSTRAINT document_template_versions_validated_with_matter_id_fkey FOREIGN KEY (validated_with_matter_id) REFERENCES public.matters(id) ON DELETE SET NULL;


--
-- Name: document_versions document_versions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_versions
    ADD CONSTRAINT document_versions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: document_versions document_versions_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_versions
    ADD CONSTRAINT document_versions_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: document_versions document_versions_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_versions
    ADD CONSTRAINT document_versions_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.matter_documents(id) ON DELETE CASCADE;


--
-- Name: draft_generation_runs draft_generation_runs_matter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.draft_generation_runs
    ADD CONSTRAINT draft_generation_runs_matter_id_fkey FOREIGN KEY (matter_id) REFERENCES public.matters(id) ON DELETE CASCADE;


--
-- Name: draft_log draft_log_design_sheet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.draft_log
    ADD CONSTRAINT draft_log_design_sheet_id_fkey FOREIGN KEY (design_sheet_id) REFERENCES public.design_sheets(id) ON DELETE SET NULL;


--
-- Name: draft_log draft_log_drafted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.draft_log
    ADD CONSTRAINT draft_log_drafted_by_fkey FOREIGN KEY (drafted_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: draft_log draft_log_matter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.draft_log
    ADD CONSTRAINT draft_log_matter_id_fkey FOREIGN KEY (matter_id) REFERENCES public.matters(id) ON DELETE SET NULL;


--
-- Name: estate_clause_preview_evidence estate_clause_preview_evidenc_revision_id_clause_id_revisi_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estate_clause_preview_evidence
    ADD CONSTRAINT estate_clause_preview_evidenc_revision_id_clause_id_revisi_fkey FOREIGN KEY (revision_id, clause_id, revision_content_hash) REFERENCES public.estate_clause_revisions(id, clause_id, content_hash) ON DELETE RESTRICT;


--
-- Name: estate_clause_preview_evidence estate_clause_preview_evidence_clause_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estate_clause_preview_evidence
    ADD CONSTRAINT estate_clause_preview_evidence_clause_id_fkey FOREIGN KEY (clause_id) REFERENCES public.estate_clauses(id) ON DELETE RESTRICT;


--
-- Name: estate_clause_preview_evidence estate_clause_preview_evidence_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estate_clause_preview_evidence
    ADD CONSTRAINT estate_clause_preview_evidence_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: estate_clause_preview_evidence estate_clause_preview_evidence_representative_matter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estate_clause_preview_evidence
    ADD CONSTRAINT estate_clause_preview_evidence_representative_matter_id_fkey FOREIGN KEY (representative_matter_id) REFERENCES public.matters(id) ON DELETE RESTRICT;


--
-- Name: estate_clause_publications estate_clause_publications_clause_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estate_clause_publications
    ADD CONSTRAINT estate_clause_publications_clause_id_fkey FOREIGN KEY (clause_id) REFERENCES public.estate_clauses(id) ON DELETE RESTRICT;


--
-- Name: estate_clause_publications estate_clause_publications_current_revision_id_clause_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estate_clause_publications
    ADD CONSTRAINT estate_clause_publications_current_revision_id_clause_id_fkey FOREIGN KEY (current_revision_id, clause_id) REFERENCES public.estate_clause_revisions(id, clause_id) ON DELETE RESTRICT;


--
-- Name: estate_clause_publications estate_clause_publications_published_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estate_clause_publications
    ADD CONSTRAINT estate_clause_publications_published_by_fkey FOREIGN KEY (published_by) REFERENCES public.users(id);


--
-- Name: estate_clause_review_events estate_clause_review_events_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estate_clause_review_events
    ADD CONSTRAINT estate_clause_review_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id);


--
-- Name: estate_clause_review_events estate_clause_review_events_clause_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estate_clause_review_events
    ADD CONSTRAINT estate_clause_review_events_clause_id_fkey FOREIGN KEY (clause_id) REFERENCES public.estate_clauses(id) ON DELETE RESTRICT;


--
-- Name: estate_clause_review_events estate_clause_review_events_revision_id_clause_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estate_clause_review_events
    ADD CONSTRAINT estate_clause_review_events_revision_id_clause_id_fkey FOREIGN KEY (revision_id, clause_id) REFERENCES public.estate_clause_revisions(id, clause_id) ON DELETE RESTRICT;


--
-- Name: estate_clause_revisions estate_clause_revisions_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estate_clause_revisions
    ADD CONSTRAINT estate_clause_revisions_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id);


--
-- Name: estate_clause_revisions estate_clause_revisions_base_published_revision_id_clause__fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estate_clause_revisions
    ADD CONSTRAINT estate_clause_revisions_base_published_revision_id_clause__fkey FOREIGN KEY (base_published_revision_id, clause_id) REFERENCES public.estate_clause_revisions(id, clause_id) ON DELETE RESTRICT;


--
-- Name: estate_clause_revisions estate_clause_revisions_base_published_revision_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estate_clause_revisions
    ADD CONSTRAINT estate_clause_revisions_base_published_revision_id_fkey FOREIGN KEY (base_published_revision_id) REFERENCES public.estate_clause_revisions(id) ON DELETE RESTRICT;


--
-- Name: estate_clause_revisions estate_clause_revisions_clause_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estate_clause_revisions
    ADD CONSTRAINT estate_clause_revisions_clause_id_fkey FOREIGN KEY (clause_id) REFERENCES public.estate_clauses(id) ON DELETE RESTRICT;


--
-- Name: estate_clause_working_drafts estate_clause_working_drafts_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estate_clause_working_drafts
    ADD CONSTRAINT estate_clause_working_drafts_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id);


--
-- Name: estate_clause_working_drafts estate_clause_working_drafts_base_published_revision_id_cl_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estate_clause_working_drafts
    ADD CONSTRAINT estate_clause_working_drafts_base_published_revision_id_cl_fkey FOREIGN KEY (base_published_revision_id, clause_id) REFERENCES public.estate_clause_revisions(id, clause_id) ON DELETE RESTRICT;


--
-- Name: estate_clause_working_drafts estate_clause_working_drafts_base_published_revision_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estate_clause_working_drafts
    ADD CONSTRAINT estate_clause_working_drafts_base_published_revision_id_fkey FOREIGN KEY (base_published_revision_id) REFERENCES public.estate_clause_revisions(id) ON DELETE RESTRICT;


--
-- Name: estate_clause_working_drafts estate_clause_working_drafts_clause_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estate_clause_working_drafts
    ADD CONSTRAINT estate_clause_working_drafts_clause_id_fkey FOREIGN KEY (clause_id) REFERENCES public.estate_clauses(id) ON DELETE CASCADE;


--
-- Name: estate_clause_working_drafts estate_clause_working_drafts_source_review_revision_id_cla_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estate_clause_working_drafts
    ADD CONSTRAINT estate_clause_working_drafts_source_review_revision_id_cla_fkey FOREIGN KEY (source_review_revision_id, clause_id) REFERENCES public.estate_clause_revisions(id, clause_id) ON DELETE RESTRICT;


--
-- Name: estate_clauses estate_clauses_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estate_clauses
    ADD CONSTRAINT estate_clauses_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: generated_document_clause_revisions generated_document_clause_rev_revision_id_clause_id_conten_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_document_clause_revisions
    ADD CONSTRAINT generated_document_clause_rev_revision_id_clause_id_conten_fkey FOREIGN KEY (revision_id, clause_id, content_hash) REFERENCES public.estate_clause_revisions(id, clause_id, content_hash) ON DELETE RESTRICT;


--
-- Name: generated_document_clause_revisions generated_document_clause_revisions_clause_id_clause_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_document_clause_revisions
    ADD CONSTRAINT generated_document_clause_revisions_clause_id_clause_key_fkey FOREIGN KEY (clause_id, clause_key) REFERENCES public.estate_clauses(id, clause_key) ON DELETE RESTRICT;


--
-- Name: generated_document_clause_revisions generated_document_clause_revisions_clause_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_document_clause_revisions
    ADD CONSTRAINT generated_document_clause_revisions_clause_id_fkey FOREIGN KEY (clause_id) REFERENCES public.estate_clauses(id) ON DELETE RESTRICT;


--
-- Name: generated_document_clause_revisions generated_document_clause_revisions_document_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_document_clause_revisions
    ADD CONSTRAINT generated_document_clause_revisions_document_version_id_fkey FOREIGN KEY (document_version_id) REFERENCES public.document_versions(id) ON DELETE RESTRICT;


--
-- Name: generated_document_clause_revisions generated_document_clause_revisions_override_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_document_clause_revisions
    ADD CONSTRAINT generated_document_clause_revisions_override_id_fkey FOREIGN KEY (override_id) REFERENCES public.matter_estate_clause_overrides(id) ON DELETE RESTRICT;


--
-- Name: generated_document_clause_revisions generated_document_clause_revisions_revision_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_document_clause_revisions
    ADD CONSTRAINT generated_document_clause_revisions_revision_id_fkey FOREIGN KEY (revision_id) REFERENCES public.estate_clause_revisions(id) ON DELETE RESTRICT;


--
-- Name: matter_contacts matter_contacts_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matter_contacts
    ADD CONSTRAINT matter_contacts_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;


--
-- Name: matter_contacts matter_contacts_matter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matter_contacts
    ADD CONSTRAINT matter_contacts_matter_id_fkey FOREIGN KEY (matter_id) REFERENCES public.matters(id) ON DELETE CASCADE;


--
-- Name: matter_details matter_details_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matter_details
    ADD CONSTRAINT matter_details_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.matters(id) ON DELETE CASCADE;


--
-- Name: matter_document_folders matter_document_folders_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matter_document_folders
    ADD CONSTRAINT matter_document_folders_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: matter_document_folders matter_document_folders_matter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matter_document_folders
    ADD CONSTRAINT matter_document_folders_matter_id_fkey FOREIGN KEY (matter_id) REFERENCES public.matters(id) ON DELETE CASCADE;


--
-- Name: matter_document_folders matter_document_folders_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matter_document_folders
    ADD CONSTRAINT matter_document_folders_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.matter_document_folders(id) ON DELETE CASCADE;


--
-- Name: matter_documents matter_documents_current_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matter_documents
    ADD CONSTRAINT matter_documents_current_version_id_fkey FOREIGN KEY (current_version_id) REFERENCES public.document_versions(id) ON DELETE SET NULL;


--
-- Name: matter_documents matter_documents_folder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matter_documents
    ADD CONSTRAINT matter_documents_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES public.matter_document_folders(id) ON DELETE SET NULL;


--
-- Name: matter_documents matter_documents_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matter_documents
    ADD CONSTRAINT matter_documents_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: matter_documents matter_documents_template_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matter_documents
    ADD CONSTRAINT matter_documents_template_version_id_fkey FOREIGN KEY (template_version_id) REFERENCES public.document_template_versions(id);


--
-- Name: matter_documents matter_documents_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matter_documents
    ADD CONSTRAINT matter_documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: matter_estate_clause_overrides matter_estate_clause_override_publication_revision_id_clau_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matter_estate_clause_overrides
    ADD CONSTRAINT matter_estate_clause_override_publication_revision_id_clau_fkey FOREIGN KEY (publication_revision_id, clause_id) REFERENCES public.estate_clause_revisions(id, clause_id) ON DELETE RESTRICT;


--
-- Name: matter_estate_clause_overrides matter_estate_clause_overrides_clause_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matter_estate_clause_overrides
    ADD CONSTRAINT matter_estate_clause_overrides_clause_id_fkey FOREIGN KEY (clause_id) REFERENCES public.estate_clauses(id) ON DELETE RESTRICT;


--
-- Name: matter_estate_clause_overrides matter_estate_clause_overrides_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matter_estate_clause_overrides
    ADD CONSTRAINT matter_estate_clause_overrides_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: matter_estate_clause_overrides matter_estate_clause_overrides_matter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matter_estate_clause_overrides
    ADD CONSTRAINT matter_estate_clause_overrides_matter_id_fkey FOREIGN KEY (matter_id) REFERENCES public.matters(id) ON DELETE CASCADE;


--
-- Name: matter_estate_clause_overrides matter_estate_clause_overrides_supersedes_override_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matter_estate_clause_overrides
    ADD CONSTRAINT matter_estate_clause_overrides_supersedes_override_id_fkey FOREIGN KEY (supersedes_override_id) REFERENCES public.matter_estate_clause_overrides(id) ON DELETE RESTRICT;


--
-- Name: matters matters_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matters
    ADD CONSTRAINT matters_client_id_fkey FOREIGN KEY (client_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: matters matters_client_intake_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matters
    ADD CONSTRAINT matters_client_intake_id_fkey FOREIGN KEY (client_intake_id) REFERENCES public.client_intake(id) ON DELETE RESTRICT;


--
-- Name: matters matters_merged_into_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.matters
    ADD CONSTRAINT matters_merged_into_id_fkey FOREIGN KEY (merged_into_id) REFERENCES public.matters(id) ON DELETE SET NULL;


--
-- Name: style_sets style_sets_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.style_sets
    ADD CONSTRAINT style_sets_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_api_keys user_api_keys_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_api_keys
    ADD CONSTRAINT user_api_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: users users_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: style_sets Staff read style sets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Staff read style sets" ON public.style_sets FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = ANY (ARRAY['admin'::text, 'attorney'::text, 'va'::text, 'staff'::text]))))));


--
-- Name: document_versions admin_all_document_versions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_all_document_versions ON public.document_versions TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = ANY (ARRAY['attorney'::text, 'admin'::text])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = ANY (ARRAY['attorney'::text, 'admin'::text]))))));


--
-- Name: matter_documents admin_all_matter_documents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_all_matter_documents ON public.matter_documents TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = ANY (ARRAY['attorney'::text, 'admin'::text])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = ANY (ARRAY['attorney'::text, 'admin'::text]))))));


--
-- Name: ai_usage; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_usage ai_usage_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ai_usage_admin_read ON public.ai_usage FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = ANY (ARRAY['attorney'::text, 'admin'::text]))))));


--
-- Name: client_intake attorneys_all_client_intake; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attorneys_all_client_intake ON public.client_intake TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = ANY (ARRAY['attorney'::text, 'admin'::text])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = ANY (ARRAY['attorney'::text, 'admin'::text]))))));


--
-- Name: contact_roles attorneys_all_contact_roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attorneys_all_contact_roles ON public.contact_roles TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = ANY (ARRAY['attorney'::text, 'admin'::text])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = ANY (ARRAY['attorney'::text, 'admin'::text]))))));


--
-- Name: contacts attorneys_all_contacts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attorneys_all_contacts ON public.contacts TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = ANY (ARRAY['attorney'::text, 'admin'::text])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = ANY (ARRAY['attorney'::text, 'admin'::text]))))));


--
-- Name: design_sheets attorneys_all_design_sheets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attorneys_all_design_sheets ON public.design_sheets TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = ANY (ARRAY['attorney'::text, 'admin'::text])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = ANY (ARRAY['attorney'::text, 'admin'::text]))))));


--
-- Name: doc_selections attorneys_all_doc_selections; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attorneys_all_doc_selections ON public.doc_selections TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = ANY (ARRAY['attorney'::text, 'admin'::text])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = ANY (ARRAY['attorney'::text, 'admin'::text]))))));


--
-- Name: matter_contacts attorneys_all_matter_contacts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attorneys_all_matter_contacts ON public.matter_contacts TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = ANY (ARRAY['attorney'::text, 'admin'::text])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = ANY (ARRAY['attorney'::text, 'admin'::text]))))));


--
-- Name: matter_details attorneys_all_matter_details; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attorneys_all_matter_details ON public.matter_details TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = ANY (ARRAY['attorney'::text, 'admin'::text])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = ANY (ARRAY['attorney'::text, 'admin'::text]))))));


--
-- Name: matters attorneys_all_matters; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attorneys_all_matters ON public.matters TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = ANY (ARRAY['attorney'::text, 'admin'::text])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = ANY (ARRAY['attorney'::text, 'admin'::text]))))));


--
-- Name: draft_log attorneys_read_draft_log; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attorneys_read_draft_log ON public.draft_log FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = ANY (ARRAY['attorney'::text, 'admin'::text]))))));


--
-- Name: document_access_audit attorneys_select_document_access_audit; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attorneys_select_document_access_audit ON public.document_access_audit FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = ANY (ARRAY['attorney'::text, 'admin'::text]))))));


--
-- Name: matter_documents client_insert_own_documents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY client_insert_own_documents ON public.matter_documents FOR INSERT TO authenticated WITH CHECK (((source = 'client'::text) AND ((EXISTS ( SELECT 1
   FROM public.matters m
  WHERE (((m.id)::text = matter_documents.matter_id) AND (m.client_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM public.v_matter_pipeline v
  WHERE (((v.matter_id)::text = matter_documents.matter_id) AND (v.client_email = (( SELECT users.email
           FROM auth.users
          WHERE (users.id = auth.uid())))::text)))))));


--
-- Name: client_intake; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_intake ENABLE ROW LEVEL SECURITY;

--
-- Name: client_intake client_intake_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY client_intake_select_own ON public.client_intake FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR (client_user_id = auth.uid())));


--
-- Name: matter_documents client_read_visible_matter_documents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY client_read_visible_matter_documents ON public.matter_documents FOR SELECT TO authenticated USING ((((shared_at IS NOT NULL) OR (uploaded_by = auth.uid())) AND ((EXISTS ( SELECT 1
   FROM public.matters m
  WHERE (((m.id)::text = matter_documents.matter_id) AND (m.client_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM public.v_matter_pipeline v
  WHERE (((v.matter_id)::text = matter_documents.matter_id) AND (v.client_email = (( SELECT u.email
           FROM auth.users u
          WHERE (u.id = auth.uid())))::text)))))));


--
-- Name: contact_roles clients_read_own_contact_roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clients_read_own_contact_roles ON public.contact_roles FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.matters m
     JOIN public.client_intake ci ON ((ci.id = m.client_intake_id)))
  WHERE ((m.id = contact_roles.matter_id) AND ((ci.user_id = auth.uid()) OR (ci.client_user_id = auth.uid()))))));


--
-- Name: contacts clients_read_own_contacts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clients_read_own_contacts ON public.contacts FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM ((public.matter_contacts mc
     JOIN public.matters m ON ((m.id = mc.matter_id)))
     JOIN public.client_intake ci ON ((ci.id = m.client_intake_id)))
  WHERE ((mc.contact_id = contacts.id) AND ((ci.user_id = auth.uid()) OR (ci.client_user_id = auth.uid()))))));


--
-- Name: design_sheets clients_read_own_design_sheets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clients_read_own_design_sheets ON public.design_sheets FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.matters m
  WHERE ((m.id = design_sheets.matter_id) AND (m.client_id = auth.uid())))));


--
-- Name: matter_contacts clients_read_own_matter_contacts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clients_read_own_matter_contacts ON public.matter_contacts FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.matters m
     JOIN public.client_intake ci ON ((ci.id = m.client_intake_id)))
  WHERE ((m.id = matter_contacts.matter_id) AND ((ci.user_id = auth.uid()) OR (ci.client_user_id = auth.uid()))))));


--
-- Name: matter_details clients_read_own_matter_details; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clients_read_own_matter_details ON public.matter_details FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.matters m
  WHERE ((m.id = matter_details.client_id) AND (m.client_id = auth.uid())))));


--
-- Name: matters clients_read_own_matters; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clients_read_own_matters ON public.matters FOR SELECT TO authenticated USING ((client_id = auth.uid()));


--
-- Name: contact_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contact_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: contacts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

--
-- Name: custom_document_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.custom_document_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: design_sheets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.design_sheets ENABLE ROW LEVEL SECURITY;

--
-- Name: doc_selections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.doc_selections ENABLE ROW LEVEL SECURITY;

--
-- Name: document_access_audit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_access_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: document_template_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_template_events ENABLE ROW LEVEL SECURITY;

--
-- Name: document_template_publications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_template_publications ENABLE ROW LEVEL SECURITY;

--
-- Name: document_template_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_template_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: document_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: draft_generation_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.draft_generation_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: draft_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.draft_log ENABLE ROW LEVEL SECURITY;

--
-- Name: estate_clause_working_drafts estate_clause_drafts_attorney_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY estate_clause_drafts_attorney_read ON public.estate_clause_working_drafts FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = ANY (ARRAY['attorney'::text, 'admin'::text]))))));


--
-- Name: estate_clause_preview_evidence; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.estate_clause_preview_evidence ENABLE ROW LEVEL SECURITY;

--
-- Name: estate_clause_preview_evidence estate_clause_preview_evidence_attorney_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY estate_clause_preview_evidence_attorney_read ON public.estate_clause_preview_evidence FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = ANY (ARRAY['attorney'::text, 'admin'::text]))))));


--
-- Name: estate_clause_publications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.estate_clause_publications ENABLE ROW LEVEL SECURITY;

--
-- Name: estate_clause_publications estate_clause_publications_staff_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY estate_clause_publications_staff_read ON public.estate_clause_publications FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = ANY (ARRAY['attorney'::text, 'admin'::text, 'va'::text, 'staff'::text]))))));


--
-- Name: estate_clause_review_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.estate_clause_review_events ENABLE ROW LEVEL SECURITY;

--
-- Name: estate_clause_review_events estate_clause_review_events_attorney_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY estate_clause_review_events_attorney_read ON public.estate_clause_review_events FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = ANY (ARRAY['attorney'::text, 'admin'::text]))))));


--
-- Name: estate_clause_revisions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.estate_clause_revisions ENABLE ROW LEVEL SECURITY;

--
-- Name: estate_clause_revisions estate_clause_revisions_authorized_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY estate_clause_revisions_authorized_read ON public.estate_clause_revisions FOR SELECT TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = ANY (ARRAY['attorney'::text, 'admin'::text]))))) OR (EXISTS ( SELECT 1
   FROM (public.users u
     JOIN public.estate_clause_publications p ON ((p.current_revision_id = estate_clause_revisions.id)))
  WHERE ((u.id = auth.uid()) AND (u.role = ANY (ARRAY['va'::text, 'staff'::text])))))));


--
-- Name: estate_clause_working_drafts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.estate_clause_working_drafts ENABLE ROW LEVEL SECURITY;

--
-- Name: estate_clauses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.estate_clauses ENABLE ROW LEVEL SECURITY;

--
-- Name: estate_clauses estate_clauses_staff_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY estate_clauses_staff_read ON public.estate_clauses FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = ANY (ARRAY['attorney'::text, 'admin'::text, 'va'::text, 'staff'::text]))))));


--
-- Name: generated_document_clause_revisions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.generated_document_clause_revisions ENABLE ROW LEVEL SECURITY;

--
-- Name: generated_document_clause_revisions generated_document_clause_revisions_staff_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY generated_document_clause_revisions_staff_read ON public.generated_document_clause_revisions FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = ANY (ARRAY['attorney'::text, 'admin'::text, 'va'::text, 'staff'::text]))))));


--
-- Name: matter_contacts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.matter_contacts ENABLE ROW LEVEL SECURITY;

--
-- Name: matter_details; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.matter_details ENABLE ROW LEVEL SECURITY;

--
-- Name: matter_document_folders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.matter_document_folders ENABLE ROW LEVEL SECURITY;

--
-- Name: matter_document_folders matter_document_folders_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY matter_document_folders_staff_all ON public.matter_document_folders TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u.role = ANY (ARRAY['attorney'::text, 'admin'::text])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u.role = ANY (ARRAY['attorney'::text, 'admin'::text]))))));


--
-- Name: matter_documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.matter_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: matter_estate_clause_overrides; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.matter_estate_clause_overrides ENABLE ROW LEVEL SECURITY;

--
-- Name: matter_estate_clause_overrides matter_estate_clause_overrides_attorney_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY matter_estate_clause_overrides_attorney_read ON public.matter_estate_clause_overrides FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.role = ANY (ARRAY['attorney'::text, 'admin'::text]))))));


--
-- Name: matters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.matters ENABLE ROW LEVEL SECURITY;

--
-- Name: rate_limits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

--
-- Name: style_sets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.style_sets ENABLE ROW LEVEL SECURITY;

--
-- Name: user_api_keys; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_api_keys ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: users users_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_insert_own ON public.users FOR INSERT TO authenticated WITH CHECK (((id = auth.uid()) AND (role = 'client'::text)));


--
-- Name: users users_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_select_own ON public.users FOR SELECT TO authenticated USING ((id = auth.uid()));


--
-- Name: users users_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_update_own ON public.users FOR UPDATE TO authenticated USING ((id = auth.uid())) WITH CHECK (((id = auth.uid()) AND (role = ( SELECT u.role
   FROM public.users u
  WHERE (u.id = auth.uid())))));


--
-- Name: FUNCTION cancel_document_template_version(p_template_id text, p_version_id uuid, p_actor_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cancel_document_template_version(p_template_id text, p_version_id uuid, p_actor_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.cancel_document_template_version(p_template_id text, p_version_id uuid, p_actor_id uuid) TO postgres;
GRANT ALL ON FUNCTION public.cancel_document_template_version(p_template_id text, p_version_id uuid, p_actor_id uuid) TO service_role;


--
-- Name: FUNCTION claim_draft_generation_run(p_id uuid, p_matter_id uuid, p_actor_id uuid, p_revision text, p_request_hash text, p_documents text[], p_worker_token uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_draft_generation_run(p_id uuid, p_matter_id uuid, p_actor_id uuid, p_revision text, p_request_hash text, p_documents text[], p_worker_token uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_draft_generation_run(p_id uuid, p_matter_id uuid, p_actor_id uuid, p_revision text, p_request_hash text, p_documents text[], p_worker_token uuid) TO postgres;
GRANT ALL ON FUNCTION public.claim_draft_generation_run(p_id uuid, p_matter_id uuid, p_actor_id uuid, p_revision text, p_request_hash text, p_documents text[], p_worker_token uuid) TO service_role;


--
-- Name: TABLE matters; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.matters TO postgres;
GRANT ALL ON TABLE public.matters TO anon;
GRANT ALL ON TABLE public.matters TO authenticated;
GRANT ALL ON TABLE public.matters TO service_role;


--
-- Name: FUNCTION delete_matter_contact(p_contact_id uuid, p_matter_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.delete_matter_contact(p_contact_id uuid, p_matter_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.delete_matter_contact(p_contact_id uuid, p_matter_id uuid) TO postgres;
GRANT ALL ON FUNCTION public.delete_matter_contact(p_contact_id uuid, p_matter_id uuid) TO service_role;


--
-- Name: FUNCTION draft_generation_metrics(p_matter_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.draft_generation_metrics(p_matter_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.draft_generation_metrics(p_matter_id uuid) TO postgres;
GRANT ALL ON FUNCTION public.draft_generation_metrics(p_matter_id uuid) TO service_role;


--
-- Name: FUNCTION drafting_hub_draft_rollups(p_matter_ids text[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.drafting_hub_draft_rollups(p_matter_ids text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.drafting_hub_draft_rollups(p_matter_ids text[]) TO postgres;
GRANT ALL ON FUNCTION public.drafting_hub_draft_rollups(p_matter_ids text[]) TO service_role;


--
-- Name: FUNCTION drafting_hub_has_documents(p_plan text, p_decisions jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.drafting_hub_has_documents(p_plan text, p_decisions jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.drafting_hub_has_documents(p_plan text, p_decisions jsonb) TO postgres;
GRANT ALL ON FUNCTION public.drafting_hub_has_documents(p_plan text, p_decisions jsonb) TO service_role;


--
-- Name: FUNCTION drafting_hub_page(p_search text, p_action text, p_practice text, p_sort text, p_page integer, p_page_size integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.drafting_hub_page(p_search text, p_action text, p_practice text, p_sort text, p_page integer, p_page_size integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.drafting_hub_page(p_search text, p_action text, p_practice text, p_sort text, p_page integer, p_page_size integer) TO postgres;
GRANT ALL ON FUNCTION public.drafting_hub_page(p_search text, p_action text, p_practice text, p_sort text, p_page integer, p_page_size integer) TO service_role;


--
-- Name: FUNCTION ensure_user_profile(p_display_name text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.ensure_user_profile(p_display_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ensure_user_profile(p_display_name text) TO postgres;
GRANT ALL ON FUNCTION public.ensure_user_profile(p_display_name text) TO authenticated;
GRANT ALL ON FUNCTION public.ensure_user_profile(p_display_name text) TO service_role;


--
-- Name: FUNCTION file_generated_draft_into_drafts_folder(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.file_generated_draft_into_drafts_folder() FROM PUBLIC;
GRANT ALL ON FUNCTION public.file_generated_draft_into_drafts_folder() TO postgres;
GRANT ALL ON FUNCTION public.file_generated_draft_into_drafts_folder() TO anon;
GRANT ALL ON FUNCTION public.file_generated_draft_into_drafts_folder() TO authenticated;
GRANT ALL ON FUNCTION public.file_generated_draft_into_drafts_folder() TO service_role;


--
-- Name: FUNCTION guard_draft_run_output(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.guard_draft_run_output() FROM PUBLIC;
GRANT ALL ON FUNCTION public.guard_draft_run_output() TO postgres;
GRANT ALL ON FUNCTION public.guard_draft_run_output() TO service_role;


--
-- Name: FUNCTION is_contact_channel_list(value jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_contact_channel_list(value jsonb) TO postgres;
GRANT ALL ON FUNCTION public.is_contact_channel_list(value jsonb) TO anon;
GRANT ALL ON FUNCTION public.is_contact_channel_list(value jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.is_contact_channel_list(value jsonb) TO service_role;


--
-- Name: FUNCTION load_estate_clause_generation_snapshot(p_matter_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.load_estate_clause_generation_snapshot(p_matter_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.load_estate_clause_generation_snapshot(p_matter_id uuid) TO postgres;
GRANT ALL ON FUNCTION public.load_estate_clause_generation_snapshot(p_matter_id uuid) TO service_role;


--
-- Name: FUNCTION lock_estate_clause_publication_changes(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.lock_estate_clause_publication_changes() FROM PUBLIC;
GRANT ALL ON FUNCTION public.lock_estate_clause_publication_changes() TO postgres;
GRANT ALL ON FUNCTION public.lock_estate_clause_publication_changes() TO service_role;


--
-- Name: FUNCTION lock_estate_template_publication_changes(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.lock_estate_template_publication_changes() FROM PUBLIC;
GRANT ALL ON FUNCTION public.lock_estate_template_publication_changes() TO postgres;
GRANT ALL ON FUNCTION public.lock_estate_template_publication_changes() TO service_role;


--
-- Name: FUNCTION persist_generated_estate_document(p_document jsonb, p_manifest jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.persist_generated_estate_document(p_document jsonb, p_manifest jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.persist_generated_estate_document(p_document jsonb, p_manifest jsonb) TO postgres;
GRANT ALL ON FUNCTION public.persist_generated_estate_document(p_document jsonb, p_manifest jsonb) TO service_role;


--
-- Name: FUNCTION prevent_estate_clause_revision_mutation(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.prevent_estate_clause_revision_mutation() FROM PUBLIC;
GRANT ALL ON FUNCTION public.prevent_estate_clause_revision_mutation() TO postgres;
GRANT ALL ON FUNCTION public.prevent_estate_clause_revision_mutation() TO service_role;


--
-- Name: FUNCTION prevent_used_estate_clause_key_change(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.prevent_used_estate_clause_key_change() FROM PUBLIC;
GRANT ALL ON FUNCTION public.prevent_used_estate_clause_key_change() TO postgres;
GRANT ALL ON FUNCTION public.prevent_used_estate_clause_key_change() TO service_role;


--
-- Name: FUNCTION publish_document_template_version(p_template_id text, p_version_id uuid, p_expected_active_version_id uuid, p_actor_id uuid, p_confirmation text, p_event_type text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.publish_document_template_version(p_template_id text, p_version_id uuid, p_expected_active_version_id uuid, p_actor_id uuid, p_confirmation text, p_event_type text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.publish_document_template_version(p_template_id text, p_version_id uuid, p_expected_active_version_id uuid, p_actor_id uuid, p_confirmation text, p_event_type text) TO postgres;
GRANT ALL ON FUNCTION public.publish_document_template_version(p_template_id text, p_version_id uuid, p_expected_active_version_id uuid, p_actor_id uuid, p_confirmation text, p_event_type text) TO service_role;


--
-- Name: FUNCTION publish_estate_clause_revision(p_revision_id uuid, p_actor_id uuid, p_expected_current_revision_id uuid, p_current_template_snapshot_hash text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.publish_estate_clause_revision(p_revision_id uuid, p_actor_id uuid, p_expected_current_revision_id uuid, p_current_template_snapshot_hash text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.publish_estate_clause_revision(p_revision_id uuid, p_actor_id uuid, p_expected_current_revision_id uuid, p_current_template_snapshot_hash text) TO postgres;
GRANT ALL ON FUNCTION public.publish_estate_clause_revision(p_revision_id uuid, p_actor_id uuid, p_expected_current_revision_id uuid, p_current_template_snapshot_hash text) TO service_role;


--
-- Name: FUNCTION rate_limit_consume(p_bucket text, p_key text, p_window_seconds integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rate_limit_consume(p_bucket text, p_key text, p_window_seconds integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rate_limit_consume(p_bucket text, p_key text, p_window_seconds integer) TO postgres;
GRANT ALL ON FUNCTION public.rate_limit_consume(p_bucket text, p_key text, p_window_seconds integer) TO service_role;


--
-- Name: FUNCTION record_estate_clause_preview(p_revision_id uuid, p_template_snapshot_hash text, p_document_types text[], p_dependency_revision_ids jsonb, p_representative_matter_id uuid, p_validation_report jsonb, p_actor_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.record_estate_clause_preview(p_revision_id uuid, p_template_snapshot_hash text, p_document_types text[], p_dependency_revision_ids jsonb, p_representative_matter_id uuid, p_validation_report jsonb, p_actor_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_estate_clause_preview(p_revision_id uuid, p_template_snapshot_hash text, p_document_types text[], p_dependency_revision_ids jsonb, p_representative_matter_id uuid, p_validation_report jsonb, p_actor_id uuid) TO postgres;
GRANT ALL ON FUNCTION public.record_estate_clause_preview(p_revision_id uuid, p_template_snapshot_hash text, p_document_types text[], p_dependency_revision_ids jsonb, p_representative_matter_id uuid, p_validation_report jsonb, p_actor_id uuid) TO service_role;


--
-- Name: FUNCTION request_estate_clause_changes(p_revision_id uuid, p_actor_id uuid, p_comment text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.request_estate_clause_changes(p_revision_id uuid, p_actor_id uuid, p_comment text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.request_estate_clause_changes(p_revision_id uuid, p_actor_id uuid, p_comment text) TO postgres;
GRANT ALL ON FUNCTION public.request_estate_clause_changes(p_revision_id uuid, p_actor_id uuid, p_comment text) TO service_role;


--
-- Name: FUNCTION retire_estate_clause_publication(p_clause_id uuid, p_expected_current_revision_id uuid, p_reason text, p_actor_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.retire_estate_clause_publication(p_clause_id uuid, p_expected_current_revision_id uuid, p_reason text, p_actor_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.retire_estate_clause_publication(p_clause_id uuid, p_expected_current_revision_id uuid, p_reason text, p_actor_id uuid) TO postgres;
GRANT ALL ON FUNCTION public.retire_estate_clause_publication(p_clause_id uuid, p_expected_current_revision_id uuid, p_reason text, p_actor_id uuid) TO service_role;


--
-- Name: FUNCTION retire_matter_estate_clause_override(p_matter_id uuid, p_clause_id uuid, p_reason text, p_actor_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.retire_matter_estate_clause_override(p_matter_id uuid, p_clause_id uuid, p_reason text, p_actor_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.retire_matter_estate_clause_override(p_matter_id uuid, p_clause_id uuid, p_reason text, p_actor_id uuid) TO postgres;
GRANT ALL ON FUNCTION public.retire_matter_estate_clause_override(p_matter_id uuid, p_clause_id uuid, p_reason text, p_actor_id uuid) TO service_role;


--
-- Name: FUNCTION revert_estate_clause_publication(p_clause_id uuid, p_target_revision_id uuid, p_expected_current_revision_id uuid, p_current_template_snapshot_hash text, p_reason text, p_actor_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.revert_estate_clause_publication(p_clause_id uuid, p_target_revision_id uuid, p_expected_current_revision_id uuid, p_current_template_snapshot_hash text, p_reason text, p_actor_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.revert_estate_clause_publication(p_clause_id uuid, p_target_revision_id uuid, p_expected_current_revision_id uuid, p_current_template_snapshot_hash text, p_reason text, p_actor_id uuid) TO postgres;
GRANT ALL ON FUNCTION public.revert_estate_clause_publication(p_clause_id uuid, p_target_revision_id uuid, p_expected_current_revision_id uuid, p_current_template_snapshot_hash text, p_reason text, p_actor_id uuid) TO service_role;


--
-- Name: FUNCTION set_updated_at(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_updated_at() TO postgres;
GRANT ALL ON FUNCTION public.set_updated_at() TO service_role;


--
-- Name: FUNCTION submit_estate_clause_revision(p_working_draft_id uuid, p_actor_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.submit_estate_clause_revision(p_working_draft_id uuid, p_actor_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.submit_estate_clause_revision(p_working_draft_id uuid, p_actor_id uuid) TO postgres;
GRANT ALL ON FUNCTION public.submit_estate_clause_revision(p_working_draft_id uuid, p_actor_id uuid) TO service_role;


--
-- Name: TABLE client_intake; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.client_intake TO postgres;
GRANT ALL ON TABLE public.client_intake TO anon;
GRANT ALL ON TABLE public.client_intake TO authenticated;
GRANT ALL ON TABLE public.client_intake TO service_role;


--
-- Name: FUNCTION upsert_matter_estate_clause_override(p_matter_id uuid, p_clause_id uuid, p_expected_current_revision_id uuid, p_action text, p_reason text, p_actor_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.upsert_matter_estate_clause_override(p_matter_id uuid, p_clause_id uuid, p_expected_current_revision_id uuid, p_action text, p_reason text, p_actor_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.upsert_matter_estate_clause_override(p_matter_id uuid, p_clause_id uuid, p_expected_current_revision_id uuid, p_action text, p_reason text, p_actor_id uuid) TO postgres;
GRANT ALL ON FUNCTION public.upsert_matter_estate_clause_override(p_matter_id uuid, p_clause_id uuid, p_expected_current_revision_id uuid, p_action text, p_reason text, p_actor_id uuid) TO service_role;


--
-- Name: TABLE ai_usage; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ai_usage TO postgres;
GRANT ALL ON TABLE public.ai_usage TO anon;
GRANT ALL ON TABLE public.ai_usage TO authenticated;
GRANT ALL ON TABLE public.ai_usage TO service_role;


--
-- Name: TABLE contacts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.contacts TO postgres;
GRANT ALL ON TABLE public.contacts TO anon;
GRANT ALL ON TABLE public.contacts TO authenticated;
GRANT ALL ON TABLE public.contacts TO service_role;


--
-- Name: TABLE matter_contacts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.matter_contacts TO postgres;
GRANT ALL ON TABLE public.matter_contacts TO anon;
GRANT ALL ON TABLE public.matter_contacts TO authenticated;
GRANT ALL ON TABLE public.matter_contacts TO service_role;


--
-- Name: TABLE contact_roles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.contact_roles TO postgres;
GRANT ALL ON TABLE public.contact_roles TO anon;
GRANT ALL ON TABLE public.contact_roles TO authenticated;
GRANT ALL ON TABLE public.contact_roles TO service_role;


--
-- Name: TABLE custom_document_templates; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.custom_document_templates TO postgres;
GRANT ALL ON TABLE public.custom_document_templates TO anon;
GRANT ALL ON TABLE public.custom_document_templates TO authenticated;
GRANT ALL ON TABLE public.custom_document_templates TO service_role;


--
-- Name: TABLE design_sheets; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.design_sheets TO postgres;
GRANT ALL ON TABLE public.design_sheets TO anon;
GRANT ALL ON TABLE public.design_sheets TO authenticated;
GRANT ALL ON TABLE public.design_sheets TO service_role;


--
-- Name: TABLE doc_selections; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.doc_selections TO postgres;
GRANT ALL ON TABLE public.doc_selections TO anon;
GRANT ALL ON TABLE public.doc_selections TO authenticated;
GRANT ALL ON TABLE public.doc_selections TO service_role;


--
-- Name: TABLE document_access_audit; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.document_access_audit TO postgres;
GRANT ALL ON TABLE public.document_access_audit TO anon;
GRANT ALL ON TABLE public.document_access_audit TO authenticated;
GRANT ALL ON TABLE public.document_access_audit TO service_role;


--
-- Name: TABLE document_template_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.document_template_events TO postgres;
GRANT ALL ON TABLE public.document_template_events TO service_role;


--
-- Name: TABLE document_template_publications; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.document_template_publications TO postgres;
GRANT ALL ON TABLE public.document_template_publications TO service_role;


--
-- Name: TABLE document_template_versions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.document_template_versions TO postgres;
GRANT ALL ON TABLE public.document_template_versions TO service_role;


--
-- Name: TABLE document_versions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.document_versions TO postgres;
GRANT ALL ON TABLE public.document_versions TO anon;
GRANT ALL ON TABLE public.document_versions TO authenticated;
GRANT ALL ON TABLE public.document_versions TO service_role;


--
-- Name: TABLE draft_generation_runs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.draft_generation_runs TO postgres;
GRANT ALL ON TABLE public.draft_generation_runs TO service_role;


--
-- Name: TABLE draft_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.draft_log TO postgres;
GRANT ALL ON TABLE public.draft_log TO anon;
GRANT ALL ON TABLE public.draft_log TO authenticated;
GRANT ALL ON TABLE public.draft_log TO service_role;


--
-- Name: TABLE estate_clause_preview_evidence; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.estate_clause_preview_evidence TO postgres;
GRANT ALL ON TABLE public.estate_clause_preview_evidence TO service_role;
GRANT SELECT ON TABLE public.estate_clause_preview_evidence TO authenticated;


--
-- Name: TABLE estate_clause_publications; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.estate_clause_publications TO postgres;
GRANT ALL ON TABLE public.estate_clause_publications TO service_role;
GRANT SELECT ON TABLE public.estate_clause_publications TO authenticated;


--
-- Name: TABLE estate_clause_review_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.estate_clause_review_events TO postgres;
GRANT ALL ON TABLE public.estate_clause_review_events TO service_role;
GRANT SELECT ON TABLE public.estate_clause_review_events TO authenticated;


--
-- Name: TABLE estate_clause_revisions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.estate_clause_revisions TO postgres;
GRANT ALL ON TABLE public.estate_clause_revisions TO service_role;
GRANT SELECT ON TABLE public.estate_clause_revisions TO authenticated;


--
-- Name: TABLE estate_clause_working_drafts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.estate_clause_working_drafts TO postgres;
GRANT ALL ON TABLE public.estate_clause_working_drafts TO service_role;
GRANT SELECT ON TABLE public.estate_clause_working_drafts TO authenticated;


--
-- Name: TABLE estate_clauses; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.estate_clauses TO postgres;
GRANT ALL ON TABLE public.estate_clauses TO service_role;
GRANT SELECT ON TABLE public.estate_clauses TO authenticated;


--
-- Name: TABLE generated_document_clause_revisions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.generated_document_clause_revisions TO postgres;
GRANT ALL ON TABLE public.generated_document_clause_revisions TO service_role;
GRANT SELECT ON TABLE public.generated_document_clause_revisions TO authenticated;


--
-- Name: TABLE matter_details; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.matter_details TO postgres;
GRANT ALL ON TABLE public.matter_details TO anon;
GRANT ALL ON TABLE public.matter_details TO authenticated;
GRANT ALL ON TABLE public.matter_details TO service_role;


--
-- Name: TABLE matter_document_folders; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.matter_document_folders TO postgres;
GRANT ALL ON TABLE public.matter_document_folders TO anon;
GRANT ALL ON TABLE public.matter_document_folders TO authenticated;
GRANT ALL ON TABLE public.matter_document_folders TO service_role;


--
-- Name: TABLE matter_documents; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.matter_documents TO postgres;
GRANT ALL ON TABLE public.matter_documents TO anon;
GRANT ALL ON TABLE public.matter_documents TO authenticated;
GRANT ALL ON TABLE public.matter_documents TO service_role;


--
-- Name: TABLE matter_estate_clause_overrides; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.matter_estate_clause_overrides TO postgres;
GRANT ALL ON TABLE public.matter_estate_clause_overrides TO service_role;
GRANT SELECT ON TABLE public.matter_estate_clause_overrides TO authenticated;


--
-- Name: TABLE rate_limits; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.rate_limits TO postgres;
GRANT ALL ON TABLE public.rate_limits TO anon;
GRANT ALL ON TABLE public.rate_limits TO authenticated;
GRANT ALL ON TABLE public.rate_limits TO service_role;


--
-- Name: TABLE style_sets; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.style_sets TO postgres;
GRANT ALL ON TABLE public.style_sets TO anon;
GRANT ALL ON TABLE public.style_sets TO authenticated;
GRANT ALL ON TABLE public.style_sets TO service_role;


--
-- Name: TABLE user_api_keys; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_api_keys TO postgres;
GRANT ALL ON TABLE public.user_api_keys TO service_role;


--
-- Name: TABLE users; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.users TO postgres;
GRANT ALL ON TABLE public.users TO anon;
GRANT ALL ON TABLE public.users TO authenticated;
GRANT ALL ON TABLE public.users TO service_role;


--
-- Name: TABLE v_matter_pipeline; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.v_matter_pipeline TO postgres;
GRANT ALL ON TABLE public.v_matter_pipeline TO anon;
GRANT ALL ON TABLE public.v_matter_pipeline TO authenticated;
GRANT ALL ON TABLE public.v_matter_pipeline TO service_role;



-- -----------------------------------------------------------------------------
-- Privileges (explicit)
-- -----------------------------------------------------------------------------
-- pg_dump writes function ACLs relative to Postgres's built-in default, so the
-- REVOKEs Cornerstone's migrations ran against anon/authenticated would be
-- lost, and Supabase's default privileges would leave every RPC above callable
-- from the browser. This block restates the source database's final grants
-- exactly: drafting RPCs are service-role only (the app calls them from route
-- handlers with the service-role client); ensure_user_profile is the one
-- authenticated users may call. Table grants follow Supabase's normal pattern;
-- RLS (enabled on every table above) is what limits rows.
REVOKE ALL ON FUNCTION public.cancel_document_template_version(text,uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_document_template_version(text,uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.claim_draft_generation_run(uuid,uuid,uuid,text,text,text[],uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_draft_generation_run(uuid,uuid,uuid,text,text,text[],uuid) TO service_role;
REVOKE ALL ON FUNCTION public.delete_matter_contact(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_matter_contact(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.draft_generation_metrics(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.draft_generation_metrics(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.drafting_hub_draft_rollups(text[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.drafting_hub_draft_rollups(text[]) TO service_role;
REVOKE ALL ON FUNCTION public.drafting_hub_has_documents(text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.drafting_hub_has_documents(text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.drafting_hub_page(text,text,text,text,integer,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.drafting_hub_page(text,text,text,text,integer,integer) TO service_role;
REVOKE ALL ON FUNCTION public.ensure_user_profile(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ensure_user_profile(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_user_profile(text) TO service_role;
REVOKE ALL ON FUNCTION public.file_generated_draft_into_drafts_folder() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.file_generated_draft_into_drafts_folder() TO anon;
GRANT EXECUTE ON FUNCTION public.file_generated_draft_into_drafts_folder() TO authenticated;
GRANT EXECUTE ON FUNCTION public.file_generated_draft_into_drafts_folder() TO service_role;
REVOKE ALL ON FUNCTION public.guard_draft_run_output() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.guard_draft_run_output() TO service_role;
REVOKE ALL ON FUNCTION public.is_contact_channel_list(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_contact_channel_list(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.is_contact_channel_list(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_contact_channel_list(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.load_estate_clause_generation_snapshot(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.load_estate_clause_generation_snapshot(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.lock_estate_clause_publication_changes() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lock_estate_clause_publication_changes() TO service_role;
REVOKE ALL ON FUNCTION public.lock_estate_template_publication_changes() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lock_estate_template_publication_changes() TO service_role;
REVOKE ALL ON FUNCTION public.persist_generated_estate_document(jsonb,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.persist_generated_estate_document(jsonb,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.prevent_estate_clause_revision_mutation() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prevent_estate_clause_revision_mutation() TO service_role;
REVOKE ALL ON FUNCTION public.prevent_used_estate_clause_key_change() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prevent_used_estate_clause_key_change() TO service_role;
REVOKE ALL ON FUNCTION public.publish_document_template_version(text,uuid,uuid,uuid,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.publish_document_template_version(text,uuid,uuid,uuid,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.publish_estate_clause_revision(uuid,uuid,uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.publish_estate_clause_revision(uuid,uuid,uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.rate_limit_consume(text,text,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rate_limit_consume(text,text,integer) TO service_role;
REVOKE ALL ON FUNCTION public.record_estate_clause_preview(uuid,text,text[],jsonb,uuid,jsonb,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_estate_clause_preview(uuid,text,text[],jsonb,uuid,jsonb,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.request_estate_clause_changes(uuid,uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.request_estate_clause_changes(uuid,uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.retire_estate_clause_publication(uuid,uuid,text,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.retire_estate_clause_publication(uuid,uuid,text,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.retire_matter_estate_clause_override(uuid,uuid,text,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.retire_matter_estate_clause_override(uuid,uuid,text,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.revert_estate_clause_publication(uuid,uuid,uuid,text,text,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revert_estate_clause_publication(uuid,uuid,uuid,text,text,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO service_role;
REVOKE ALL ON FUNCTION public.submit_estate_clause_revision(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_estate_clause_revision(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.upsert_matter_estate_clause_override(uuid,uuid,uuid,text,text,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_matter_estate_clause_override(uuid,uuid,uuid,text,text,uuid) TO service_role;

REVOKE ALL ON TABLE public.ai_usage FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.ai_usage TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.ai_usage TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.ai_usage TO service_role;
REVOKE ALL ON TABLE public.client_intake FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.client_intake TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.client_intake TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.client_intake TO service_role;
REVOKE ALL ON TABLE public.contact_roles FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.contact_roles TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.contact_roles TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.contact_roles TO service_role;
REVOKE ALL ON TABLE public.contacts FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.contacts TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.contacts TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.contacts TO service_role;
REVOKE ALL ON TABLE public.custom_document_templates FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.custom_document_templates TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.custom_document_templates TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.custom_document_templates TO service_role;
REVOKE ALL ON TABLE public.design_sheets FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.design_sheets TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.design_sheets TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.design_sheets TO service_role;
REVOKE ALL ON TABLE public.doc_selections FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.doc_selections TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.doc_selections TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.doc_selections TO service_role;
REVOKE ALL ON TABLE public.document_access_audit FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.document_access_audit TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.document_access_audit TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.document_access_audit TO service_role;
REVOKE ALL ON TABLE public.document_template_events FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.document_template_events TO service_role;
REVOKE ALL ON TABLE public.document_template_publications FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.document_template_publications TO service_role;
REVOKE ALL ON TABLE public.document_template_versions FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.document_template_versions TO service_role;
REVOKE ALL ON TABLE public.document_versions FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.document_versions TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.document_versions TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.document_versions TO service_role;
REVOKE ALL ON TABLE public.draft_generation_runs FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.draft_generation_runs TO service_role;
REVOKE ALL ON TABLE public.draft_log FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.draft_log TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.draft_log TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.draft_log TO service_role;
REVOKE ALL ON TABLE public.estate_clause_preview_evidence FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE public.estate_clause_preview_evidence TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.estate_clause_preview_evidence TO service_role;
REVOKE ALL ON TABLE public.estate_clause_publications FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE public.estate_clause_publications TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.estate_clause_publications TO service_role;
REVOKE ALL ON TABLE public.estate_clause_review_events FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE public.estate_clause_review_events TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.estate_clause_review_events TO service_role;
REVOKE ALL ON TABLE public.estate_clause_revisions FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE public.estate_clause_revisions TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.estate_clause_revisions TO service_role;
REVOKE ALL ON TABLE public.estate_clause_working_drafts FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE public.estate_clause_working_drafts TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.estate_clause_working_drafts TO service_role;
REVOKE ALL ON TABLE public.estate_clauses FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE public.estate_clauses TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.estate_clauses TO service_role;
REVOKE ALL ON TABLE public.generated_document_clause_revisions FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE public.generated_document_clause_revisions TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.generated_document_clause_revisions TO service_role;
REVOKE ALL ON TABLE public.matter_contacts FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.matter_contacts TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.matter_contacts TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.matter_contacts TO service_role;
REVOKE ALL ON TABLE public.matter_details FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.matter_details TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.matter_details TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.matter_details TO service_role;
REVOKE ALL ON TABLE public.matter_document_folders FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.matter_document_folders TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.matter_document_folders TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.matter_document_folders TO service_role;
REVOKE ALL ON TABLE public.matter_documents FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.matter_documents TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.matter_documents TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.matter_documents TO service_role;
REVOKE ALL ON TABLE public.matter_estate_clause_overrides FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE public.matter_estate_clause_overrides TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.matter_estate_clause_overrides TO service_role;
REVOKE ALL ON TABLE public.matters FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.matters TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.matters TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.matters TO service_role;
REVOKE ALL ON TABLE public.rate_limits FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.rate_limits TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.rate_limits TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.rate_limits TO service_role;
REVOKE ALL ON TABLE public.style_sets FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.style_sets TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.style_sets TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.style_sets TO service_role;
REVOKE ALL ON TABLE public.user_api_keys FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.user_api_keys TO service_role;
REVOKE ALL ON TABLE public.users FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.users TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.users TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.users TO service_role;
REVOKE ALL ON TABLE public.v_matter_pipeline FROM anon, authenticated, service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.v_matter_pipeline TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.v_matter_pipeline TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.v_matter_pipeline TO service_role;

-- -----------------------------------------------------------------------------
-- Storage buckets
-- -----------------------------------------------------------------------------
-- Uploaded / published DOCX masters and custom quick-draft templates
-- (lib/documentTemplates/{resolver,repository,customTemplates}.ts).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('document-template-versions', 'document-template-versions', false, 15728640,
        ARRAY['application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
ON CONFLICT (id) DO NOTHING;

-- Legacy "supabase" engine only (ESTATE_GENERATOR_ENGINE=supabase,
-- lib/drafting/generateDocuments.ts). Not needed with the default node engine.
INSERT INTO storage.buckets (id, name, public) VALUES ('templates', 'templates', false)
ON CONFLICT (id) DO NOTHING;

-- Generated drafts, document versions and PDFs live in Cloudflare R2, not here.
