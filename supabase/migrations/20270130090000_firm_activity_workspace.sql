-- Read-only firm history. Task events are already recorded in lead/matter activity.
-- A run is shown at its recorded start time with its current status; no synthetic history.
create or replace view public.v_firm_activity with (security_invoker = true) as
with events as (
  select 'matter:' || a.id::text as id, 'matter'::text as source, a.created_at as occurred_at,
    a.event_type, a.title as summary, a.actor_id, a.matter_id::text, null::uuid as lead_id,
    null::uuid as person_id, '/admin/matters/' || a.matter_id || '?tab=activity' as href,
    null::text as status
  from public.matter_activity a
  union all
  select 'lead:' || a.id, 'lead', a.created_at, a.event_type, a.title, a.actor_id,
    i.matter_id::text, a.lead_id, null::uuid, '/admin/leads/' || a.lead_id, null::text
  from public.lead_activity a join public.client_intake i on i.id = a.lead_id
  where not exists (select 1 from public.matter_activity m where m.id = a.source_matter_activity_id)
  union all
  select 'crm:' || a.id, 'crm', a.created_at, coalesce(a.event_type,a.type),
    coalesce(a.subject,a.event_type,a.type), a.performed_by_user_id,
    coalesce(p.cornerstone_matter_id,p.matter_id)::text, p.client_intake_id, a.person_id,
    case when p.client_intake_id is not null then '/admin/leads/' || p.client_intake_id
      when coalesce(p.cornerstone_matter_id,p.matter_id) is not null then '/admin/matters/' || coalesce(p.cornerstone_matter_id,p.matter_id) || '?tab=activity'
      else '/admin/crm/people' end, a.status
  from public.cornerstone_crm_activities a left join public.v_cornerstone_crm_people p on p.id=a.person_id
  where not (coalesce(a.source_type,'') = 'lead_activity' and exists (select 1 from public.lead_activity l where l.id::text=a.source_id))
    and not (coalesce(a.source_type,'') = 'matter_activity' and exists (select 1 from public.matter_activity m where m.id::text=a.source_id))
  union all
  select 'drafting:' || r.id, 'drafting', r.created_at, 'draft_generation_started',
    'Document generation', r.created_by, r.matter_id::text, null::uuid, null::uuid,
    '/admin/drafting/' || r.matter_id, r.status
  from public.draft_generation_runs r
  union all
  select 'review:' || r.id, 'review', r.started_at, r.kind || '_started',
    case when r.kind='review' then 'Document review' else 'Field audit' end,
    (to_jsonb(r)->>'created_by')::uuid, coalesce(r.matter_id,u.matter_id)::text, null::uuid, null::uuid,
    case when r.kind='review' then '/admin/review/' || r.id else '/admin/field-audits/' || r.id end, r.status
  from public.workflow_runs r left join public.review_uploads u on u.id=r.review_upload_id
  where r.kind in ('review', 'field_audit')
  union all
  select 'scan:' || s.id, 'scan', s.started_at, s.kind || '_started',
    case when s.kind='proofread' then 'Proofreading' else 'Issue spotting' end,
    s.created_by, u.matter_id::text, null::uuid, null::uuid, '/admin/review/scans/' || s.id, s.status
  from public.document_scans s left join public.review_uploads u on u.id=s.review_upload_id
)
select e.id,e.source,e.occurred_at,e.event_type,e.summary,e.actor_id,e.matter_id,
  coalesce(e.lead_id,m.client_intake_id) as lead_id,e.person_id,e.href,e.status, coalesce(m.name, nullif(concat_ws(' ',i.first_name,i.last_name),''), i.full_name) as record_name,
  coalesce(u.display_name,u.email) as actor_name,
  array(select p.id from public.v_cornerstone_crm_people p
    where p.id=e.person_id or p.client_intake_id=coalesce(e.lead_id,m.client_intake_id) or p.related_intake_id=coalesce(e.lead_id,m.client_intake_id)
      or p.cornerstone_matter_id::text=e.matter_id or p.matter_id::text=e.matter_id) as person_ids
from events e
left join public.matters m on m.id::text=e.matter_id
left join public.client_intake i on i.id=e.lead_id
left join public.users u on u.id=e.actor_id;

-- Service-role reads only, behind requireStaffPage; never expose firm history to clients.
revoke all on public.v_firm_activity from public, anon, authenticated;
grant select on public.v_firm_activity to service_role;
create index if not exists matter_activity_feed_order on public.matter_activity(created_at desc,id desc);
create index if not exists lead_activity_feed_order on public.lead_activity(created_at desc,id desc);
create index if not exists crm_activity_feed_order on public.cornerstone_crm_activities(created_at desc,id desc);
create index if not exists draft_runs_feed_order on public.draft_generation_runs(created_at desc,id desc);
create index if not exists workflow_runs_feed_order on public.workflow_runs(started_at desc,id desc);
create index if not exists document_scans_feed_order on public.document_scans(started_at desc,id desc);
notify pgrst, 'reload schema';
