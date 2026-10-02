-- Tasks page: never split one matter's tasks across pages when grouping by matter.
--
-- `firm_task_page_v1` pages the firm's queue 50 rows at a time in due-date
-- order. The page's "Group: Matter" view then grouped only the rows it was
-- handed, so a matter with tasks due this week and next month showed up as a
-- partial group on page 1 and again on page 3 — the one view whose whole point
-- is "everything for this matter, together" was the one it broke.
--
-- With `group = 'matter'` the function now pages by record instead: records
-- (matter, else lead, else "no record") are ordered by their most urgent task,
-- then packed onto pages whole — a page closes before a record that would push
-- it past `pageSize`, and a record larger than a page gets a page to itself.
-- Because pages no longer hold a fixed number of rows, the result also carries
-- `pageCount`.
--
-- Backwards compatible in both directions, because app and migration deploy in
-- no guaranteed order: the signature is unchanged, a caller that omits `group`
-- gets exactly the previous rows, and an app that sends `group` to the previous
-- function body has it ignored (and falls back to total / pageSize).

create or replace function public.firm_task_page_v1(p_query jsonb)
returns jsonb language plpgsql stable security invoker
set search_path = pg_catalog, public as $$
declare
  v_page integer := greatest(1, coalesce((p_query->>'page')::integer, 1));
  v_size integer := least(100, greatest(1, coalesce((p_query->>'pageSize')::integer, 50)));
  v_viewer uuid := nullif(p_query->>'viewerId','')::uuid;
  v_scope text := coalesce(p_query->>'scope','mine');
  v_status text := coalesce(p_query->>'status','open');
  v_group text := coalesce(p_query->>'group','due');
  v_result jsonb;
begin
  if v_scope not in ('mine','team','unassigned','all') or v_status not in ('open','done') then
    raise exception 'Invalid task filter' using errcode='22023';
  end if;
  if v_group not in ('due','priority','matter') then
    raise exception 'Invalid task grouping' using errcode='22023';
  end if;
  with recursive base as materialized (
    select t.*, case t.priority when 'high' then 0 when 'normal' then 1 else 2 end as priority_rank,
      coalesce(t.matter_id::text, t.lead_id::text, '') as record_key
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
  ), records as materialized (
    -- Most urgent record first; tasks tied to no record last.
    select record_key, count(*) as n,
      row_number() over (
        order by (record_key = ''), min(effective_due_at) nulls last, min(created_at), record_key
      ) as rn
    from filtered where v_group = 'matter'
    group by record_key
  ), packed(rn, record_key, page_no, fill) as (
    select r.rn, r.record_key, 1, r.n from records r where r.rn = 1
    union all
    select r.rn, r.record_key,
      case when p.fill + r.n > v_size then p.page_no + 1 else p.page_no end,
      case when p.fill + r.n > v_size then r.n else p.fill + r.n end
    from packed p join records r on r.rn = p.rn + 1
  ), page_rows as (
    select * from (
      select f.*, 0::bigint as record_rank from filtered f where v_group <> 'matter'
      order by effective_due_at nulls last, priority_rank, created_at, id
      offset (v_page::bigint-1)*v_size limit v_size
    ) by_due
    union all
    select f.*, k.rn as record_rank
    from filtered f join packed k on k.record_key = f.record_key
    where v_group = 'matter' and k.page_no = v_page
  )
  select jsonb_build_object(
    'rows',coalesce((select jsonb_agg(to_jsonb(r)-'priority_rank'-'record_key'-'record_rank'
      order by record_rank, effective_due_at nulls last, priority_rank, created_at, id) from page_rows r),'[]'::jsonb),
    'total',(select count(*) from filtered), 'page',v_page,'pageSize',v_size,
    'pageCount', case when v_group = 'matter'
      then coalesce((select max(page_no) from packed), 1)
      else greatest(1, ceil((select count(*) from filtered)::numeric / v_size)::integer) end,
    'group', v_group,
    'scopeCounts',jsonb_build_object(
      'mine',(select count(*) from base where assignee_id=v_viewer),
      'team',(select count(*) from base where assignee_id<>v_viewer),
      'unassigned',(select count(*) from base where assignee_id is null))
  ) into v_result;
  return v_result;
end $$;
revoke all on function public.firm_task_page_v1(jsonb) from public, anon, authenticated;
grant execute on function public.firm_task_page_v1(jsonb) to service_role;
