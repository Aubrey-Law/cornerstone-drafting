-- Bounded, snapshot-consistent worklist. No writes and no public/client access.
-- Mirrors getDocumentInclusions for the hub summary (which has no children or
-- matter_type). Keep parity fixtures with the TypeScript inclusion defaults.
create or replace function public.drafting_hub_has_documents(p_plan text, p_decisions jsonb)
returns boolean language sql immutable security invoker set search_path = '' as $$
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
revoke all on function public.drafting_hub_has_documents(text, jsonb) from public, anon, authenticated;
grant execute on function public.drafting_hub_has_documents(text, jsonb) to service_role;

create or replace function public.drafting_hub_page(
  p_search text default '', p_action text default 'all', p_practice text default 'all',
  p_sort text default 'updated', p_page integer default 1, p_page_size integer default 50
) returns jsonb language sql stable security invoker set search_path = '' as $$
  with settings as (
    select greatest(1, least(coalesce(p_page_size, 50), 50)) as page_size,
      greatest(1, coalesce(p_page, 1)) as requested_page
  ), pipeline as materialized (
    -- A legacy intake with multiple spouse contacts must still be one matter.
    select distinct on (v.matter_id) v.* from public.v_matter_pipeline v
    where v.stage in ('design', 'drafting', 'client_review', 'drafts_approved', 'revision')
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
revoke all on function public.drafting_hub_page(text, text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.drafting_hub_page(text, text, text, text, integer, integer) to service_role;
