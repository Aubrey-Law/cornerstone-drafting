-- Cornerstone — unify stage_tasks into a first-class `tasks` table.
--
-- Manual tasks and auto-fired stage-engine tasks now live in one queue. A task
-- relates to a matter (public.matters) or a lead (public.client_intake — leads
-- are intake records, there is no separate `leads` table), or to neither.
--
-- Existing `stage_tasks` rows migrate in with source = 'stage'. The stage engine
-- keeps its (matter_id, stage_key, stage_entered_at) idempotency key.

-- ── Task templates ──────────────────────────────────────────────────────────

create table if not exists public.task_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  -- [{ text, offset_days?, priority? }] in display order
  items       jsonb not null default '[]'::jsonb,
  archived_at timestamptz,
  created_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists task_templates_name_unique
  on public.task_templates (lower(name)) where archived_at is null;

-- ── Tasks ───────────────────────────────────────────────────────────────────

create table if not exists public.tasks (
  id                uuid primary key default gen_random_uuid(),
  title             text not null,
  description       text,
  status            text not null default 'open'
    check (status in ('open', 'in_progress', 'blocked', 'done', 'archived')),
  priority          text not null default 'normal'
    check (priority in ('high', 'normal', 'low')),
  source            text not null default 'manual'
    check (source in ('manual', 'stage', 'template', 'cadence')),
  task_type         text not null default 'single'
    check (task_type in ('single', 'checklist')),
  checklist         jsonb not null default '[]'::jsonb,

  -- Relation: at most one of these is set.
  matter_id         uuid references public.matters(id) on delete cascade,
  lead_id           uuid references public.client_intake(id) on delete cascade,

  -- Stage-engine fields, carried over from stage_tasks.
  stage_key         text,
  stage_entered_at  timestamptz,
  batch_tag         text,
  soft_due_at       timestamptz,
  hard_due_at       timestamptz,

  due_at            timestamptz,
  assignee_id       uuid references public.users(id) on delete set null,
  estimate_minutes  int check (estimate_minutes is null or estimate_minutes >= 0),
  remind_at         timestamptz,
  -- { every: 14, unit: 'day' | 'week' | 'month', until?: 'funded' | iso date, paused?: bool }
  recurrence        jsonb,
  template_id       uuid references public.task_templates(id) on delete set null,
  document_id       uuid references public.matter_documents(id) on delete set null,
  completed_at      timestamptz,
  completed_by      uuid references public.users(id) on delete set null,
  created_by        uuid references public.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint tasks_one_relation check (num_nonnulls(matter_id, lead_id) <= 1)
);

-- Effective due date = coalesce(due_at, soft_due_at, hard_due_at). Indexed as an
-- expression so the open-queue sort stays index-ordered.
create index if not exists tasks_open_due
  on public.tasks (status, (coalesce(due_at, soft_due_at, hard_due_at)))
  where status <> 'done';
create index if not exists tasks_matter on public.tasks (matter_id);
create index if not exists tasks_lead on public.tasks (lead_id);
create index if not exists tasks_assignee on public.tasks (assignee_id, status);

-- The stage engine upserts on this key. Deliberately NOT a partial index:
-- `ON CONFLICT (cols)` cannot infer a partial index without repeating its
-- predicate, and PostgREST's on_conflict never emits one. It stays safe for
-- manual tasks because they leave stage_key and stage_entered_at null, and a
-- unique index treats nulls as distinct.
create unique index if not exists tasks_stage_engine_key
  on public.tasks (matter_id, stage_key, stage_entered_at);

create or replace function public.tasks_set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tasks_updated_at on public.tasks;
create trigger tasks_updated_at
  before update on public.tasks
  for each row execute function public.tasks_set_updated_at();

drop trigger if exists task_templates_updated_at on public.task_templates;
create trigger task_templates_updated_at
  before update on public.task_templates
  for each row execute function public.tasks_set_updated_at();

-- ── Migrate existing stage_tasks ────────────────────────────────────────────
-- Idempotent: skips rows already carried over on a previous run.

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'stage_tasks'
  ) then
    insert into public.tasks (
      title, status, priority, source, task_type, checklist,
      matter_id, stage_key, stage_entered_at, batch_tag,
      soft_due_at, hard_due_at, due_at, completed_at, created_at, updated_at
    )
    select
      st.title,
      st.status,
      'normal',
      'stage',
      st.task_type,
      coalesce(st.checklist, '[]'::jsonb),
      st.matter_id,
      st.stage_key,
      st.stage_entered_at,
      st.batch_tag,
      st.soft_due_at,
      st.hard_due_at,
      -- Stage tasks work off the soft date; hard_due_at stays the SLA badge.
      st.soft_due_at,
      case when st.status = 'done' then st.created_at end,
      st.created_at,
      st.created_at
    from public.stage_tasks st
    where not exists (
      select 1 from public.tasks t
      where t.source = 'stage'
        and t.matter_id = st.matter_id
        and t.stage_key = st.stage_key
        and t.stage_entered_at = st.stage_entered_at
    );
  end if;
end
$$;

-- ── RLS — same staff-only policy stage_tasks used ───────────────────────────

alter table public.tasks enable row level security;
alter table public.task_templates enable row level security;

drop policy if exists "attorneys_all_tasks" on public.tasks;
create policy "attorneys_all_tasks"
  on public.tasks for all to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('attorney', 'admin')))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('attorney', 'admin')));

drop policy if exists "attorneys_all_task_templates" on public.task_templates;
create policy "attorneys_all_task_templates"
  on public.task_templates for all to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('attorney', 'admin')))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('attorney', 'admin')));

grant select, insert, update, delete on public.tasks to authenticated;
grant select, insert, update, delete on public.task_templates to authenticated;

notify pgrst, 'reload schema';
