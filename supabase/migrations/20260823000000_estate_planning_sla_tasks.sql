-- Cornerstone — SLA-driven task templates for estate planning matters.
--
-- A template is a reusable blueprint: a target turnaround (in days) plus an
-- ordered array of task definitions, each carrying offsets from the matter's
-- start date for its due / nudge / escalation dates. Kicking off a matter
-- instantiates the blueprint into dated `matter_tasks` rows.
--
-- Naming note: the blueprint table is `sla_task_templates`, not `task_templates`.
-- `public.task_templates` already exists (20260729132012_unified_tasks.sql) as the
-- checklist library behind the unified Tasks queue, with an incompatible shape
-- (name / items). The two systems are deliberately separate: the unified queue is
-- ad-hoc firm work, this one is the dated SLA spine for a matter.
--
-- Snapshot semantics: editing a template never rewrites tasks already generated
-- for a matter. Each matter keeps the copy it was generated from.

-- ── SLA templates ───────────────────────────────────────────────────────────

create table if not exists public.sla_task_templates (
  id            uuid primary key default gen_random_uuid(),
  template_name text not null unique,
  description   text,
  -- Target turnaround for the SLA proper (engagement → signing). Tasks may run
  -- past it; post-signing closeout deliberately does.
  target_days   integer not null,
  -- [{ phase, name, due_offset_days, nudge_offset_days, nudge_tier,
  --    escalation_offset_days, escalation_tier, assignee, skill, auto,
  --    conditional, pauses_clock }] in display order
  tasks         jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── Instantiated matter tasks ───────────────────────────────────────────────

create table if not exists public.matter_tasks (
  id            uuid primary key default gen_random_uuid(),
  matter_id     uuid not null references public.matters(id) on delete cascade,
  template_id   uuid references public.sla_task_templates(id) on delete set null,
  phase         text not null,
  name          text not null,
  -- Position within the template, preserved so a phase's tasks display in the
  -- order they were authored and "downstream" is well defined when the clock
  -- pauses and later due dates shift.
  sort_order    integer not null default 0,
  assignee      text not null default 'attorney',
  skill         text,
  conditional   boolean not null default false,
  pauses_clock  boolean not null default false,

  -- Computed dates
  start_date       date not null,
  due_date         date not null,
  nudge_date       date,
  nudge_tier       text,
  escalation_date  date,
  escalation_tier  text,

  -- Status tracking
  status       text not null default 'pending'
    check (status in ('pending', 'active', 'completed', 'skipped', 'blocked')),
  completed_at timestamptz,
  skipped_at   timestamptz,
  notes        text,

  -- Clock pause tracking. `total_paused_days` is the delay this task alone
  -- contributed; summing it across a matter gives the matter's total slip.
  paused_at         timestamptz,
  total_paused_days integer not null default 0,

  -- Nudge tracking
  nudge_sent_at      timestamptz,
  escalation_sent_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_matter_tasks_matter_id on public.matter_tasks(matter_id);
create index if not exists idx_matter_tasks_status on public.matter_tasks(status);
create index if not exists idx_matter_tasks_due_date on public.matter_tasks(due_date);
-- The nudge cron scans open tasks whose nudge/escalation date has landed.
create index if not exists idx_matter_tasks_nudge_due
  on public.matter_tasks(nudge_date)
  where nudge_sent_at is null and status in ('pending', 'active');

-- ── updated_at ──────────────────────────────────────────────────────────────
-- Reuses the trigger function the unified tasks migration installed.

drop trigger if exists sla_task_templates_updated_at on public.sla_task_templates;
create trigger sla_task_templates_updated_at
  before update on public.sla_task_templates
  for each row execute function public.tasks_set_updated_at();

drop trigger if exists matter_tasks_updated_at on public.matter_tasks;
create trigger matter_tasks_updated_at
  before update on public.matter_tasks
  for each row execute function public.tasks_set_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Staff-only, matching every other matter-scoped table in this schema. A blanket
-- `to authenticated using (true)` would expose matter tasks to portal clients,
-- who authenticate against the same Supabase project.

alter table public.sla_task_templates enable row level security;
alter table public.matter_tasks enable row level security;

drop policy if exists "attorneys_all_sla_task_templates" on public.sla_task_templates;
create policy "attorneys_all_sla_task_templates"
  on public.sla_task_templates for all to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('attorney', 'admin')))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('attorney', 'admin')));

drop policy if exists "attorneys_all_matter_tasks" on public.matter_tasks;
create policy "attorneys_all_matter_tasks"
  on public.matter_tasks for all to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('attorney', 'admin')))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('attorney', 'admin')));

grant select, insert, update, delete on public.sla_task_templates to authenticated;
grant select, insert, update, delete on public.matter_tasks to authenticated;

-- ── Seed: the standard estate planning SLA ──────────────────────────────────

insert into public.sla_task_templates (template_name, description, target_days, tasks)
values (
  'estate_planning_sla',
  'Standard 6-week estate planning SLA — engagement to signing, plus 1-week post-signing closeout.',
  42,
  '[
    {"phase":"onboarding","name":"Create matter folder in OneDrive","due_offset_days":0,"nudge_offset_days":null,"nudge_tier":null,"assignee":"attorney","skill":"new-matter-folder","auto":true,"conditional":false,"pauses_clock":false},
    {"phase":"onboarding","name":"Send intake questionnaire","due_offset_days":0,"nudge_offset_days":null,"nudge_tier":null,"assignee":"attorney","skill":null,"auto":false,"conditional":false,"pauses_clock":false},
    {"phase":"onboarding","name":"Send invoice / payment link","due_offset_days":1,"nudge_offset_days":null,"nudge_tier":null,"assignee":"attorney","skill":"qbo-invoice","auto":false,"conditional":false,"pauses_clock":false},
    {"phase":"onboarding","name":"Client returns questionnaire & documents","due_offset_days":7,"nudge_offset_days":5,"nudge_tier":"gentle","assignee":"client","skill":null,"auto":false,"conditional":false,"pauses_clock":true},
    {"phase":"design","name":"Run PMPS prep","due_offset_days":10,"nudge_offset_days":9,"nudge_tier":"internal","assignee":"attorney","skill":"pmps-prep","auto":false,"conditional":false,"pauses_clock":false},
    {"phase":"design","name":"Hold Peace of Mind Planning Session","due_offset_days":14,"nudge_offset_days":null,"nudge_tier":null,"assignee":"attorney","skill":null,"auto":false,"conditional":false,"pauses_clock":false},
    {"phase":"design","name":"Finalize design sheet","due_offset_days":14,"nudge_offset_days":null,"nudge_tier":null,"assignee":"attorney","skill":null,"auto":false,"conditional":false,"pauses_clock":false},
    {"phase":"drafting","name":"Draft document package","due_offset_days":21,"nudge_offset_days":19,"nudge_tier":"internal","assignee":"attorney","skill":"draft-estate-plan-documents","auto":false,"conditional":false,"pauses_clock":false},
    {"phase":"drafting","name":"Draft deed(s) if applicable","due_offset_days":23,"nudge_offset_days":null,"nudge_tier":null,"assignee":"attorney","skill":"deed-drafting","auto":false,"conditional":true,"pauses_clock":false},
    {"phase":"drafting","name":"Internal QA review","due_offset_days":25,"nudge_offset_days":null,"nudge_tier":null,"assignee":"attorney","skill":null,"auto":false,"conditional":false,"pauses_clock":false},
    {"phase":"drafting","name":"Deliver drafts to client","due_offset_days":28,"nudge_offset_days":26,"nudge_tier":"internal","assignee":"attorney","skill":null,"auto":false,"conditional":false,"pauses_clock":false},
    {"phase":"review","name":"Client review window opens","due_offset_days":29,"nudge_offset_days":null,"nudge_tier":null,"assignee":"client","skill":null,"auto":true,"conditional":false,"pauses_clock":false},
    {"phase":"review","name":"Client submits feedback","due_offset_days":35,"nudge_offset_days":33,"nudge_tier":"gentle","escalation_offset_days":37,"escalation_tier":"firm","assignee":"client","skill":null,"auto":false,"conditional":false,"pauses_clock":true},
    {"phase":"review","name":"Incorporate revisions","due_offset_days":35,"nudge_offset_days":null,"nudge_tier":null,"assignee":"attorney","skill":null,"auto":false,"conditional":false,"pauses_clock":false},
    {"phase":"signing","name":"Final revisions complete","due_offset_days":38,"nudge_offset_days":null,"nudge_tier":null,"assignee":"attorney","skill":null,"auto":false,"conditional":false,"pauses_clock":false},
    {"phase":"signing","name":"Schedule signing meeting","due_offset_days":38,"nudge_offset_days":36,"nudge_tier":"internal","assignee":"attorney","skill":null,"auto":false,"conditional":false,"pauses_clock":false},
    {"phase":"signing","name":"Signing meeting held","due_offset_days":42,"nudge_offset_days":null,"nudge_tier":null,"assignee":"attorney","skill":null,"auto":false,"conditional":false,"pauses_clock":false},
    {"phase":"post_signing","name":"Generate estate plan summary","due_offset_days":44,"nudge_offset_days":null,"nudge_tier":null,"assignee":"attorney","skill":"generate-estate-plan-summary","auto":false,"conditional":false,"pauses_clock":false},
    {"phase":"post_signing","name":"Draft closing / funding package","due_offset_days":45,"nudge_offset_days":null,"nudge_tier":null,"assignee":"attorney","skill":"trust-funding","auto":false,"conditional":false,"pauses_clock":false},
    {"phase":"post_signing","name":"Deliver closing package to client","due_offset_days":47,"nudge_offset_days":null,"nudge_tier":null,"assignee":"attorney","skill":null,"auto":false,"conditional":false,"pauses_clock":false},
    {"phase":"post_signing","name":"File legal plan claim (if applicable)","due_offset_days":49,"nudge_offset_days":null,"nudge_tier":null,"assignee":"attorney","skill":"metlife-claim","auto":false,"conditional":true,"pauses_clock":false}
  ]'::jsonb
)
on conflict (template_name) do nothing;

notify pgrst, 'reload schema';
