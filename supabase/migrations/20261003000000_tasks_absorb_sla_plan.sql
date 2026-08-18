-- Cornerstone — fold the SLA plan into the unified tasks table.
--
-- `public.matter_tasks` and `public.tasks` were two implementations of the same
-- idea. The stage engine fired "Draft documents — {client}" into `tasks` with a
-- soft/hard due pair while the SLA template generated "Draft full document
-- package" into `matter_tasks` for the same phase: one piece of work, two rows,
-- two statuses, two due dates, and no link between them. The SLA rows also never
-- reached the firm-wide queue, the Today queue, or the rail, because every one of
-- those reads `tasks`.
--
-- After this migration there is one store. A plan task is a `tasks` row with
-- source = 'sla'; the plan columns below carry everything `matter_tasks` knew and
-- `tasks` did not — anchor-relative offsets, nudge/escalation dates, the clock
-- pause, gates and variants.
--
-- Vocabulary is unified too. matter_tasks statuses map onto task statuses:
--   pending → open, active → in_progress, completed → done, blocked → blocked,
--   skipped → archived (with skipped_at set, which is what tells the two apart).
-- `assignee` ('attorney' | 'client' | 'automation') becomes `owner`
-- ('firm' | 'client' | 'automation'), because the queue surfaces filter on
-- "is this the firm's to do" and `assignee_id` already means a named person.
--
-- Dates: matter_tasks stored calendar days, tasks stores timestamptz. Plan days
-- land at 12:00Z, which is the same calendar day in America/New_York either side
-- of a DST change — the convention the SLA tab and the nudge cron already used
-- when they rendered `${date_key}T12:00:00Z`.
--
-- `public.matter_tasks` is left in place, read by nothing, so the copy can be
-- verified against the original. A follow-up migration drops it.

-- ── Plan columns on tasks ───────────────────────────────────────────────────

alter table public.tasks
  -- The pipeline stage this task belongs to. Distinct from `stage_key`, which
  -- holds the *engine* key ('revisions', 'closeout'); `phase` holds the pipeline
  -- stage ('revision', 'post_execution') so the plan groups the way the matter
  -- header's stage strip reads. Null on ad-hoc work that belongs to no stage.
  add column if not exists phase                   text,
  -- Who owes the work. Client- and automation-owned rows are real plan entries
  -- that consume the clock, but they are not the firm's to-do list, so the queue
  -- surfaces filter them out and only the plan view shows them.
  add column if not exists owner                   text not null default 'firm',
  -- The SLA blueprint this row was generated from. Deliberately not
  -- `template_id`, which already points at public.task_templates — the ad-hoc
  -- checklist library, a different thing with an incompatible shape.
  add column if not exists plan_template_id        uuid references public.sla_task_templates(id) on delete set null,
  -- Position in the plan. Also the axis "downstream" is measured along when a
  -- paused clock pushes later work out.
  add column if not exists sort_order              integer not null default 0,
  add column if not exists skill                   text,
  -- Attorney's running notes on the row, as opposed to `description`, which is
  -- the template's own text.
  add column if not exists notes                   text,

  -- Anchor-relative scheduling. `relative_to` null means Day 0, the engagement
  -- signature; the offsets are kept on the row so re-dating after an anchor
  -- moves recomputes rather than accumulates.
  add column if not exists plan_start_date         date,
  add column if not exists relative_to             text,
  add column if not exists due_offset_days         integer,
  add column if not exists nudge_offset_days       integer,
  add column if not exists escalation_offset_days  integer,

  -- Nudges and escalations, driven by the sla-task-nudges cron.
  add column if not exists nudge_at                timestamptz,
  add column if not exists nudge_tier              text,
  add column if not exists escalation_at           timestamptz,
  add column if not exists escalation_tier         text,
  add column if not exists nudge_sent_at           timestamptz,
  add column if not exists escalation_sent_at      timestamptz,

  -- Clock pause. `total_paused_days` is the delay this row alone contributed;
  -- summing it across a matter gives the matter's slip.
  add column if not exists pauses_clock            boolean not null default false,
  add column if not exists paused_at               timestamptz,
  add column if not exists total_paused_days       integer not null default 0,

  add column if not exists pre_engagement          boolean not null default false,
  add column if not exists auto                    boolean not null default false,
  add column if not exists conditional             boolean not null default false,
  add column if not exists gate                    text,
  add column if not exists variant                 text,
  add column if not exists extends_target_days     integer,
  add column if not exists recurring_interval_days integer,
  add column if not exists triggers_day_zero       boolean not null default false,

  -- Set alongside status = 'archived' when a task is skipped as not applicable.
  -- Archived-and-skipped and archived-and-abandoned look the same otherwise, and
  -- only the first counts as plan progress.
  add column if not exists skipped_at              timestamptz;

-- ── Constraints ─────────────────────────────────────────────────────────────

-- Dropped by definition rather than by name: an unnamed column check gets an
-- auto-generated name, and leaving an old one in place would reject every
-- source = 'sla' insert while looking like the new constraint was applied.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.tasks'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%source%'
  loop
    execute format('alter table public.tasks drop constraint %I', c.conname);
  end loop;
end
$$;

alter table public.tasks
  add constraint tasks_source_check
  check (source in ('manual', 'stage', 'template', 'cadence', 'sla'));

alter table public.tasks drop constraint if exists tasks_owner_check;
alter table public.tasks
  add constraint tasks_owner_check
  check (owner in ('firm', 'client', 'automation'));

alter table public.tasks drop constraint if exists tasks_relative_to_check;
alter table public.tasks
  add constraint tasks_relative_to_check
  check (relative_to is null or relative_to in ('discovery_call', 'pmps'));

alter table public.tasks drop constraint if exists tasks_nudge_tier_check;
alter table public.tasks
  add constraint tasks_nudge_tier_check
  check (nudge_tier is null or nudge_tier in ('gentle', 'firm', 'internal'));

alter table public.tasks drop constraint if exists tasks_escalation_tier_check;
alter table public.tasks
  add constraint tasks_escalation_tier_check
  check (escalation_tier is null or escalation_tier in ('gentle', 'firm', 'internal'));

-- ── Indexes ─────────────────────────────────────────────────────────────────

-- The plan view reads one matter's rows in plan order.
create index if not exists tasks_plan_order
  on public.tasks (matter_id, sort_order)
  where source = 'sla';

-- The nudge cron scans open tasks whose nudge/escalation date has landed.
create index if not exists tasks_nudge_due
  on public.tasks (nudge_at)
  where nudge_sent_at is null and status in ('open', 'in_progress');
create index if not exists tasks_escalation_due
  on public.tasks (escalation_at)
  where escalation_sent_at is null and status in ('open', 'in_progress');

-- ── Carry matter_tasks over ─────────────────────────────────────────────────
-- Ids are preserved, so the copy is idempotent and any link already pointing at
-- a plan task still resolves. Rows whose matter has been deleted are dropped
-- rather than carried as orphans.

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'matter_tasks'
  ) then
    insert into public.tasks (
      id, matter_id, source, title, notes, status, priority, task_type,
      phase, owner, plan_template_id, sort_order, skill,
      plan_start_date, due_at, hard_due_at,
      nudge_at, nudge_tier, escalation_at, escalation_tier,
      nudge_sent_at, escalation_sent_at,
      due_offset_days, nudge_offset_days, escalation_offset_days, relative_to,
      pre_engagement, auto, conditional, gate, variant,
      extends_target_days, recurring_interval_days, triggers_day_zero,
      pauses_clock, paused_at, total_paused_days,
      completed_at, skipped_at, created_at, updated_at
    )
    select
      mt.id,
      mt.matter_id,
      'sla',
      mt.name,
      mt.notes,
      case mt.status
        when 'pending'   then 'open'
        when 'active'    then 'in_progress'
        when 'completed' then 'done'
        when 'skipped'   then 'archived'
        when 'blocked'   then 'blocked'
        else 'open'
      end,
      'normal',
      'single',
      mt.phase,
      case when mt.assignee = 'attorney' then 'firm' else mt.assignee end,
      mt.template_id,
      mt.sort_order,
      mt.skill,
      mt.start_date,
      case when mt.due_date is null then null
           else (mt.due_date + time '12:00') at time zone 'UTC' end,
      case when mt.due_date is null then null
           else (mt.due_date + time '12:00') at time zone 'UTC' end,
      case when mt.nudge_date is null then null
           else (mt.nudge_date + time '12:00') at time zone 'UTC' end,
      mt.nudge_tier,
      case when mt.escalation_date is null then null
           else (mt.escalation_date + time '12:00') at time zone 'UTC' end,
      mt.escalation_tier,
      mt.nudge_sent_at,
      mt.escalation_sent_at,
      mt.due_offset_days,
      mt.nudge_offset_days,
      mt.escalation_offset_days,
      mt.relative_to,
      mt.pre_engagement,
      mt.auto,
      mt.conditional,
      mt.gate,
      mt.variant,
      mt.extends_target_days,
      mt.recurring_interval_days,
      mt.triggers_day_zero,
      mt.pauses_clock,
      mt.paused_at,
      mt.total_paused_days,
      mt.completed_at,
      mt.skipped_at,
      mt.created_at,
      mt.updated_at
    from public.matter_tasks mt
    where exists (select 1 from public.matters m where m.id = mt.matter_id)
    on conflict (id) do nothing;

    comment on table public.matter_tasks is
      'Superseded by public.tasks (source = ''sla''). Kept read-only so the '
      'consolidation can be verified against the original; a follow-up migration drops it.';
  end if;
end
$$;

-- ── Backfill `phase` on stage-engine tasks ──────────────────────────────────
-- Stage tasks carry the engine key in `stage_key`; the plan groups by pipeline
-- stage. Map the ones that differ so existing stage tasks land in the right
-- group instead of falling into "no stage".

update public.tasks
set phase = case stage_key
  when 'proposal_ea_out'   then 'engagement_sent'
  when 'design'            then 'design'
  when 'drafting'          then 'drafting'
  when 'revisions'         then 'revision'
  when 'signing_scheduled' then 'signing_scheduled'
  when 'closeout'          then 'post_execution'
  when 'funding'           then 'funding'
end
where source = 'stage' and phase is null and stage_key is not null;

notify pgrst, 'reload schema';
