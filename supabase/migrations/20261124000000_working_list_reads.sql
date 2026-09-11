-- Created with the Supabase CLI; allocated after current migration history.
-- Service-only reads: route/page authorization remains mandatory.
create or replace function public.firm_task_page_v1(p_query jsonb)
returns jsonb language plpgsql stable security invoker
set search_path = pg_catalog, public as $$
declare
  v_page integer := greatest(1, coalesce((p_query->>'page')::integer, 1));
  v_size integer := least(100, greatest(1, coalesce((p_query->>'pageSize')::integer, 50)));
  v_viewer uuid := nullif(p_query->>'viewerId','')::uuid;
  v_scope text := coalesce(p_query->>'scope','mine');
  v_status text := coalesce(p_query->>'status','open');
  v_result jsonb;
begin
  if v_scope not in ('mine','team','unassigned','all') or v_status not in ('open','done') then
    raise exception 'Invalid task filter' using errcode='22023';
  end if;
  with base as materialized (
    select t.*, case t.priority when 'high' then 0 when 'normal' then 1 else 2 end as priority_rank
    from public.tasks t where t.owner='firm' and
      ((v_status='open' and t.status in ('open','in_progress','blocked')) or (v_status='done' and t.status='done'))
  ), filtered as materialized (
    select * from base t where
      (v_scope='all' or (v_scope='mine' and t.assignee_id=v_viewer) or
        (v_scope='team' and t.assignee_id<>v_viewer) or (v_scope='unassigned' and t.assignee_id is null))
      and (nullif(p_query->>'source','all') is null or t.source=p_query->>'source')
      and (nullif(p_query->>'priority','all') is null or t.priority=p_query->>'priority')
      and (nullif(p_query->>'assignee','all') is null or t.assignee_id=nullif(p_query->>'assignee','all')::uuid)
      and (p_query->>'completedOn' is null or
        (t.completed_at at time zone 'America/New_York')::date=(p_query->>'completedOn')::date)
  ), page_rows as (
    select * from filtered order by effective_due_at nulls last, priority_rank, created_at, id
    offset (v_page::bigint-1)*v_size limit v_size
  )
  select jsonb_build_object(
    'rows',coalesce((select jsonb_agg(to_jsonb(r)-'priority_rank' order by effective_due_at nulls last, priority_rank, created_at, id) from page_rows r),'[]'::jsonb),
    'total',(select count(*) from filtered), 'page',v_page,'pageSize',v_size,
    'scopeCounts',jsonb_build_object(
      'mine',(select count(*) from base where assignee_id=v_viewer),
      'team',(select count(*) from base where assignee_id<>v_viewer),
      'unassigned',(select count(*) from base where assignee_id is null))
  ) into v_result;
  return v_result;
end $$;
revoke all on function public.firm_task_page_v1(jsonb) from public, anon, authenticated;
grant execute on function public.firm_task_page_v1(jsonb) to service_role;

create or replace function public.firm_lead_summary_v1()
returns jsonb language sql stable security invoker
set search_path = pg_catalog, public as $$
select jsonb_build_object(
  'all', count(*),
  'open', count(*) filter (where coalesce(lead_status,'lead')='lead'),
  'lost', count(*) filter (where lead_status='lost'),
  'declined', count(*) filter (where lead_status='declined'),
  'attention', count(*) filter (where is_open and needs_attention),
  'agreements', count(*) filter (where is_open and has_pending_agreement),
  'awaitingIntake', count(*) filter (where is_open and awaiting_intake),
  'quotedPipeline', coalesce(sum(engagement_fee_quoted) filter (where is_open),0)
) from public.v_lead_list
$$;
revoke all on function public.firm_lead_summary_v1() from public, anon, authenticated;
grant execute on function public.firm_lead_summary_v1() to service_role;

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
  where v.status<>'archived'
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

create or replace function public.firm_ledger_page_v1(p_query jsonb)
returns jsonb language sql stable security invoker
set search_path = pg_catalog, public as $$
with settings as (
 select coalesce((p_query->>'today')::date,(now() at time zone 'America/New_York')::date) as today,
   least(100,greatest(1,coalesce((p_query->>'pageSize')::int,50))) as size
), payments_running as (
 select p.*,sum(p.amount) over(partition by billing_item_id order by received_at,id rows unbounded preceding) as running
 from public.billing_payments p
), paid as (
 select p.billing_item_id,sum(p.amount) collected,min(p.received_at) filter(where p.running>=b.amount_billed) paid_at
 from payments_running p join public.billing_items b on b.id=p.billing_item_id group by p.billing_item_id
), base as materialized (
 select b.*,coalesce(p.collected,0) as collected,greatest(0,b.amount_billed-coalesce(p.collected,0)) as balance,p.paid_at,
   m.matter_number,coalesce(v.client_name,v.matter_name,'Unknown client') as client_name,v.client_email,
   coalesce(d.practice_area,v.practice_area) practice_area,coalesce(d.plan_type,v.plan_type) plan_type,d.legal_plan,
   i.number invoice_number,case when i.status='void' then null else i.due_date end invoice_due_on,
   case when b.status='paid' then 0 else greatest(0,s.today-(coalesce(b.invoiced_at,b.created_at) at time zone 'America/New_York')::date) end as age_days
 from public.billing_items b left join paid p on p.billing_item_id=b.id
 left join public.matters m on m.id=b.matter_id left join public.v_matter_pipeline v on v.matter_id=b.matter_id
 left join public.matter_details d on d.client_id=b.matter_id left join public.invoices i on i.id=b.invoice_id cross join settings s
), rows_with_status as materialized (
 select b.*,balance>0 and (case when invoice_due_on is not null then s.today>invoice_due_on else invoiced_at is not null and age_days>30 end) as overdue
 from base b cross join settings s
), filtered as materialized (
 select * from rows_with_status b where
 (coalesce(p_query->>'filter','open')='all' or (p_query->>'filter'='open' and balance>0) or
 (p_query->>'filter'='overdue' and overdue) or
 (p_query->>'filter'='to_invoice' and invoice_id is null and kind<>'plan_claim' and balance>0) or
 (p_query->>'filter'='paid' and balance=0 and to_char(paid_at at time zone 'America/New_York','YYYY-MM')=p_query->>'month'))
 and (coalesce(trim(p_query->>'search'),'')='' or strpos(lower(client_name||' '||coalesce(matter_number,'')||' '||label),lower(trim(p_query->>'search')))>0)
), paging as (
 select size,greatest(1,least(coalesce((p_query->>'page')::int,1),ceil((select count(*) from filtered)/size::numeric)::int)) as page from settings
), selected as (
 select * from filtered order by (balance>0) desc,coalesce(invoiced_at,created_at),client_name,id
 offset (select (page-1)*size from paging) limit (select size from paging)
)
select jsonb_build_object('page',(select page from paging),'pageSize',(select size from paging),'total',(select count(*) from filtered),
 'counts',jsonb_build_object('all',(select count(*) from rows_with_status),'open',(select count(*) from rows_with_status where balance>0),
 'overdue',(select count(*) from rows_with_status where overdue),
 'to_invoice',(select count(*) from rows_with_status where invoice_id is null and kind<>'plan_claim' and balance>0),
 'paid',(select count(*) from rows_with_status where balance=0 and to_char(paid_at at time zone 'America/New_York','YYYY-MM')=p_query->>'month')),
 'rows',coalesce((select jsonb_agg(jsonb_build_object(
 'id',b.id,'matterId',b.matter_id,'kind',b.kind,'label',b.label,'plan',b.plan,'amountBilled',b.amount_billed,'status',b.status,
 'invoicedAt',b.invoiced_at,'source',b.source,'lastRemindedAt',b.last_reminded_at,'createdAt',b.created_at,'clientName',b.client_name,
 'clientEmail',b.client_email,'matterNumber',b.matter_number,'practiceArea',b.practice_area,'planType',b.plan_type,'legalPlan',b.legal_plan,
 'invoiceId',b.invoice_id,'invoiceNumber',b.invoice_number,'invoiceDueOn',b.invoice_due_on,
 'collected',b.collected,'balance',b.balance,'paidAt',b.paid_at,'ageDays',b.age_days,'overdue',b.overdue,
 'payments',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'billingItemId',p.billing_item_id,'amount',p.amount,'method',p.method,'note',p.note,'receivedAt',p.received_at,'paymentGroupId',p.payment_group_id,'invoiceId',p.invoice_id) order by p.received_at,p.id) from public.billing_payments p where p.billing_item_id=b.id),'[]'::jsonb)
 ) order by (balance>0) desc,coalesce(invoiced_at,created_at),client_name,id) from selected b),'[]'::jsonb))
$$;
revoke all on function public.firm_ledger_page_v1(jsonb) from public, anon, authenticated;
grant execute on function public.firm_ledger_page_v1(jsonb) to service_role;

create or replace function public.firm_billing_matter_options_v1(p_search text, p_selected uuid default null)
returns jsonb language sql stable security invoker
set search_path = pg_catalog, public as $$
select coalesce(jsonb_agg(to_jsonb(r) order by label,id),'[]'::jsonb) from (
 select m.id,coalesce(v.client_name,v.matter_name,m.name,'Unknown client')||case when m.matter_number is null then '' else ' · '||m.matter_number end as label,
 exists(select 1 from public.billing_items b where b.matter_id=m.id and b.kind='flat_fee') as "hasLegalFee"
 from public.matters m left join public.v_matter_pipeline v on v.matter_id=m.id
 where m.id=p_selected or coalesce(trim(p_search),'')='' or strpos(lower(coalesce(v.client_name,v.matter_name,m.name,'')||' '||coalesce(m.matter_number,'')),lower(trim(p_search)))>0
 order by (m.id=p_selected) desc nulls last,label,m.id limit 100
) r
$$;
revoke all on function public.firm_billing_matter_options_v1(text,uuid) from public, anon, authenticated;
grant execute on function public.firm_billing_matter_options_v1(text,uuid) to service_role;
