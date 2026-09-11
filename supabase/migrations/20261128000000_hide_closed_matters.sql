-- Closed matters leave the working lists.
--
-- A matter is closed along either of two axes and the firm uses both: the
-- Close-out card moves the stage to `closed`, while the details card's Matter
-- status sets `closed` or `archived`. Both lists read one axis or neither, so a
-- matter that had plainly been closed kept its row in Matters and its place in
-- the drafting worklist. Mirrored in TypeScript by `isClosedMatter`
-- (lib/matters/closedMatter.ts), which decides the same thing for the rows the
-- browser filters itself.
--
-- Matters keeps a way back: `closed` in the query object ('hide' by default,
-- 'show' to include them) is what the list's Closed toggle sends. Drafting has
-- no toggle on purpose — it is a worklist of document work still to do, and a
-- closed matter has none.
--
-- Service-only reads: route/page authorization remains mandatory.
create or replace function public.firm_matter_page_v1(p_query jsonb)
returns jsonb language sql stable security invoker
set search_path = pg_catalog, public as $$
with intake_uploads as (
  select d.client_intake_id,count(*) as n from public.intake_documents d
  join public.client_intake i on i.id=d.client_intake_id
  where d.created_at>coalesce(i.uploads_reviewed_at,'1970-01-01'::timestamptz) group by d.client_intake_id
), portal_uploads as (
  select d.matter_id,count(*) as n from public.matter_documents d
  join public.matters m on m.id::text=d.matter_id
  where d.source='client' and d.created_at>coalesce(m.portal_uploads_reviewed_at,'1970-01-01'::timestamptz) group by d.matter_id
), base as materialized (
  select v.*, m.matter_number,
    coalesce(i.n,0) as unreviewed_intake_upload_count,coalesce(p.n,0) as unreviewed_portal_upload_count,
    coalesce(i.n,0)+coalesce(p.n,0) as unreviewed_upload_count,
    greatest(v.documents_executed_at,v.drafts_sent_at,v.intake_submitted_at,v.matter_created) as last_activity,
    case when v.stage in ('design','drafting') then 'active'
      when v.stage in ('client_review','revision','drafts_approved') then 'work'
      when v.stage in ('signing_scheduled','signing_complete') then 'done'
      when v.stage in ('post_execution','funding','closed') then 'closed' else 'early' end as stage_group
  from public.v_matter_pipeline v join public.matters m on m.id=v.matter_id
  left join intake_uploads i on i.client_intake_id=m.client_intake_id
  left join portal_uploads p on p.matter_id=m.id::text
  -- Counts, chips and insights all read from here, so hiding closed matters at
  -- the snapshot keeps the numbers agreeing with the rows on screen.
  where case when coalesce(p_query->>'closed','hide')='show'
    then true else v.status not in ('closed','archived') and v.stage<>'closed' end
), flagged as materialized (
  select *, stage_group<>'closed' and (unreviewed_upload_count>0 or last_activity is null or last_activity<now()-interval '14 days') as needs_attention,
    stage_group<>'closed' and documents_executed_at is null and signing_date::timestamptz between now()-interval '1 day' and now()+interval '30 days' as signing_soon
  from base
), filtered as materialized (
  select * from flagged v where
    (coalesce(p_query->>'stage','all')='all' or v.stage_group=p_query->>'stage') and
    (coalesce(p_query->>'practice','all')='all' or lower(trim(v.practice_area))=lower(trim(p_query->>'practice'))) and
    (coalesce(p_query->>'card','')='' or (p_query->>'card'='attention' and needs_attention) or (p_query->>'card'='signing' and signing_soon)) and
    (coalesce(trim(p_query->>'search'),'')='' or exists (select 1 from unnest(array[v.matter_number,v.client_name,v.client_email,v.client_phone,v.matter_name,v.practice_area,v.stage,v.intake_status]) field where strpos(lower(coalesce(field,'')),lower(trim(p_query->>'search')))>0))
), numbered as (
  select *,row_number() over (order by
    case when p_query->>'sort'='last_activity' then last_activity end desc nulls last,
    case when p_query->>'sort'='newest' then matter_created end desc nulls last,
    case when p_query->>'sort'='oldest' then matter_created end asc nulls last,
    case when p_query->>'sort'='client_asc' then nullif(trim(client_name),'') end asc nulls last,
    case when p_query->>'sort'='client_desc' then nullif(trim(client_name),'') end desc nulls last,
    case when p_query->>'sort'='matter_number' then nullif(trim(matter_number),'') end asc nulls last,
    matter_id) as rn from filtered
), ranked as (
  select *,row_number() over (partition by stage_group order by rn) as column_rn,
    count(*) over (partition by stage_group) as column_total from numbered
), settings as (
  select least(100,greatest(1,coalesce((p_query->>'pageSize')::int,50))) as size,
    greatest(1,least(coalesce((p_query->>'page')::int,1),ceil((select count(*) from filtered)/least(100,greatest(1,coalesce((p_query->>'pageSize')::int,50)))::numeric)::int)) as page
), selected as (
  select r.* from ranked r cross join settings s where
    case when p_query->>'view'='board' then column_rn between
      (greatest(1,least(coalesce((p_query->'groupPages'->>stage_group)::int,1),ceil(column_total/s.size::numeric)::int))-1)*s.size+1 and
      greatest(1,least(coalesce((p_query->'groupPages'->>stage_group)::int,1),ceil(column_total/s.size::numeric)::int))*s.size
    else rn between (s.page-1)*s.size+1 and s.page*s.size end
)
select jsonb_build_object(
  'rows',coalesce((select jsonb_agg(to_jsonb(r)-array['rn','column_rn','column_total','last_activity','stage_group','needs_attention','signing_soon'] order by rn) from selected r),'[]'::jsonb),
  'total',(select count(*) from filtered),'page',(select page from settings),'pageSize',(select size from settings),
  'groups',coalesce((select jsonb_object_agg(stage_group,n) from (select stage_group,count(*) n from flagged group by stage_group) g),'{}'::jsonb),
  'columns',coalesce((select jsonb_object_agg(stage_group,n) from (select stage_group,count(*) n from filtered group by stage_group) g),'{}'::jsonb),
  'insights',jsonb_build_object('open',(select count(*) from flagged where stage_group<>'closed'),
    'attention',(select count(*) from flagged where needs_attention),'signing',(select count(*) from flagged where signing_soon),
    'intakePending',(select count(*) from flagged where stage_group<>'closed' and intake_submitted_at is null),
    'unreviewed',coalesce((select sum(unreviewed_upload_count) from flagged where stage_group<>'closed'),0))
)
$$;
revoke all on function public.firm_matter_page_v1(jsonb) from public, anon, authenticated;
grant execute on function public.firm_matter_page_v1(jsonb) to service_role;

-- Drafting worklist: same definition of closed, no toggle. The stage filter
-- already dropped a matter parked at the `closed` stage; what it could not see
-- was a matter closed or archived by status while its stage still read
-- `drafting`, which is exactly the row that sat in the worklist forever.
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
revoke all on function public.drafting_hub_page(text, text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.drafting_hub_page(text, text, text, text, integer, integer) to service_role;
