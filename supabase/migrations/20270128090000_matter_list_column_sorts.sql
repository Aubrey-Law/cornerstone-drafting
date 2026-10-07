-- Matters list: every sortable column header maps to a sort key.
create or replace function public.firm_matter_page_v1(p_query jsonb)
returns jsonb language sql stable security invoker
set search_path = pg_catalog, public as $$
with work_input as (
  select array(
    select jsonb_array_elements_text(coalesce(p_query->'attentionIds', '[]'::jsonb))
  ) as attention_ids
), intake_uploads as (
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
  where case when coalesce(p_query->>'closed','hide')='show'
    then true else v.status not in ('closed','archived') and v.stage<>'closed' end
), flagged as materialized (
  select *, stage_group<>'closed' and matter_id::text=any(w.attention_ids) as needs_attention,
    stage_group<>'closed' and documents_executed_at is null and signing_date::timestamptz between now()-interval '1 day' and now()+interval '30 days' as signing_soon
  from base cross join work_input w
), filtered as materialized (
  select * from flagged v where
    (coalesce(p_query->>'stage','all')='all' or v.stage_group=p_query->>'stage') and
    (coalesce(p_query->>'practice','all')='all' or lower(trim(v.practice_area))=lower(trim(p_query->>'practice'))) and
    (coalesce(p_query->>'card','')='' or (p_query->>'card'='attention' and needs_attention) or (p_query->>'card'='signing' and signing_soon)) and
    (coalesce(trim(p_query->>'search'),'')='' or exists (select 1 from unnest(array[v.matter_number,v.client_name,v.client_email,v.client_phone,v.matter_name,v.practice_area,v.stage,v.intake_status]) field where strpos(lower(coalesce(field,'')),lower(trim(p_query->>'search')))>0))
), numbered as (
  select *,row_number() over (order by
    case when p_query->>'card'='attention' then array_position(w.attention_ids,matter_id::text) end asc nulls last,
    case when p_query->>'sort'='last_activity' then last_activity end desc nulls last,
    case when p_query->>'sort'='newest' then matter_created end desc nulls last,
    case when p_query->>'sort'='oldest' then matter_created end asc nulls last,
    case when p_query->>'sort'='client_asc' then nullif(trim(client_name),'') end asc nulls last,
    case when p_query->>'sort'='client_desc' then nullif(trim(client_name),'') end desc nulls last,
    case when p_query->>'sort'='matter_number' then nullif(trim(matter_number),'') end asc nulls last,
    case when p_query->>'sort'='last_activity_oldest' then last_activity end asc nulls last,
    case when p_query->>'sort'='matter_number_desc' then nullif(trim(matter_number),'') end desc nulls last,
    case when p_query->>'sort'='practice_asc' then nullif(trim(practice_area),'') end asc nulls last,
    case when p_query->>'sort'='practice_desc' then nullif(trim(practice_area),'') end desc nulls last,
    case when p_query->>'sort'='stage_asc' then array_position(array['intake','intake_review','design','drafting','client_review','revision','drafts_approved','signing_scheduled','signing_complete','post_execution','funding','closed'],stage::text) end asc nulls last,
    case when p_query->>'sort'='stage_desc' then array_position(array['intake','intake_review','design','drafting','client_review','revision','drafts_approved','signing_scheduled','signing_complete','post_execution','funding','closed'],stage::text) end desc nulls last,
    case when p_query->>'sort'='intake_asc' then nullif(trim(intake_status),'') end asc nulls last,
    case when p_query->>'sort'='intake_desc' then nullif(trim(intake_status),'') end desc nulls last,
    matter_id) as rn from filtered cross join work_input w
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

notify pgrst, 'reload schema';
