-- Cornerstone — estate planning SLA v3 (lead to signing).
--
-- v1 (20260823000000) modelled one clock: every task offset from the matter's
-- start date. v3 runs two, because the pre-engagement stretch is client-driven
-- and cannot carry a firm commitment:
--
--   Soft clock   ~14 days, anchored to the discovery call and the PMPS date.
--                Offsets are relative (`relative_to` + `due_offset_days`), and a
--                task whose anchor has not happened yet has no due date at all.
--   Firm clock   28 days, anchored to Day 0 = engagement signature. This is the
--                v1 model, unchanged: `relative_to` null means Day 0.
--
-- v1 templates keep working — a task with no `relative_to` and no `pre_engagement`
-- flag behaves exactly as it did before.

-- ── Template-level targets ──────────────────────────────────────────────────
-- `target_days` stays the blended lead-to-signing figure so existing progress
-- maths is untouched; the two clocks get their own columns.

alter table public.sla_task_templates
  add column if not exists target_days_pre_engagement integer,
  add column if not exists target_days_engagement     integer;

-- ── Task-level v3 fields ────────────────────────────────────────────────────

alter table public.matter_tasks
  -- Which clock this task hangs off: null = Day 0 (engagement signed),
  -- 'discovery_call' or 'pmps' = the soft pre-engagement anchors.
  add column if not exists relative_to             text,
  -- The offsets this row was generated from, kept so dates can be recomputed
  -- when a soft anchor lands late: the organizer is due the day before a PMPS
  -- that is not on the calendar at generation time. Without these, an undated
  -- task could never be dated, because the row stores results, not inputs.
  add column if not exists due_offset_days         integer,
  add column if not exists nudge_offset_days       integer,
  add column if not exists escalation_offset_days  integer,
  add column if not exists pre_engagement          boolean not null default false,
  -- Fires without attorney action (the post-discovery email, folder creation).
  add column if not exists auto                    boolean not null default false,
  -- Precondition that must be true before the task is generated or fires.
  -- 'fit_confirmed' gates the whole post-discovery sequence on the attorney
  -- marking the lead a fit; a not-a-fit decision skips it and stops there.
  add column if not exists gate                    text,
  -- Activating this task pushes the target date (and every downstream due date)
  -- out by this many days. Round 2 revisions are the only current user: +5.
  add column if not exists extends_target_days     integer,
  -- Task repeats on this cadence until resolved (funding check-ins: 30 days;
  -- remote-signing chase: 7).
  add column if not exists recurring_interval_days integer,
  -- Alternative branch this task belongs to. Null = always applicable;
  -- 'remote_signing' = the DIY signing path that replaces the in-person one.
  add column if not exists variant                 text,
  -- The task whose completion starts the firm clock.
  add column if not exists triggers_day_zero       boolean not null default false;

alter table public.matter_tasks
  drop constraint if exists matter_tasks_relative_to_check,
  add constraint matter_tasks_relative_to_check
    check (relative_to is null or relative_to in ('discovery_call', 'pmps'));

-- Tasks generated before this migration were all Day-0 relative, so their
-- offsets are recoverable from the dates they already carry.
update public.matter_tasks
set due_offset_days        = due_date - start_date,
    nudge_offset_days      = case when nudge_date is not null then nudge_date - start_date end,
    escalation_offset_days = case when escalation_date is not null then escalation_date - start_date end
where due_offset_days is null
  and due_date is not null;

-- A pre-engagement task is undated until its anchor lands: the organizer is due
-- the day before a PMPS that has not been scheduled yet. Storing null beats
-- storing a fictional date that the nudge cron would act on.
alter table public.matter_tasks
  alter column due_date drop not null;

create index if not exists idx_matter_tasks_pre_engagement
  on public.matter_tasks(matter_id)
  where pre_engagement;

-- The nudge cron's partial index assumed a non-null due date; undated tasks must
-- not surface in it.
drop index if exists public.idx_matter_tasks_nudge_due;
create index if not exists idx_matter_tasks_nudge_due
  on public.matter_tasks(nudge_date)
  where nudge_sent_at is null and nudge_date is not null and status in ('pending', 'active');

-- ── Seed: estate planning SLA v3 ────────────────────────────────────────────
--
-- `phase` is the Cornerstone pipeline stage the task belongs to, so the SLA plan
-- groups by the same stages as the matter header's stage strip. The SLA
-- document's own stage names map onto the existing ones rather than replacing
-- them: Discovery = new_lead, PMPS Scheduled = intake_sent, Recommendations Sent
-- = engagement_sent, Engaged = intake, Ready to Sign = signing_scheduled,
-- Signed = signing_complete, Post-Signing = post_execution, Complete = closed.
-- `funding` is the one stage the SLA needed that did not already exist
-- (20260824000002). `intake_review` and `drafts_approved` carry no tasks — they
-- are review checkpoints, not work.
--
-- Pre-engagement tasks carry `relative_to` + `due_offset_days` (offset from that
-- anchor, negative meaning "before"). Post-engagement tasks carry
-- `due_offset_days` alone, offset from Day 0.

insert into public.sla_task_templates (
  template_name, description, target_days, target_days_pre_engagement, target_days_engagement, tasks
)
values (
  'estate_planning_sla_v3',
  'Lead to signing, 6 weeks blended. Pre-engagement: ~14-day soft target (discovery, PMPS, recommendations, engagement). Post-engagement: 28-day firm SLA (design, drafting, review, signing), plus post-signing wrap-up and funding monitoring.',
  42, 14, 28,
  '[
    {"phase":"new_lead","name":"Lead schedules 15-min discovery call","due_offset_days":null,"relative_to":null,"assignee":"client","pre_engagement":true},
    {"phase":"new_lead","name":"Hold discovery call","due_offset_days":0,"relative_to":"discovery_call","assignee":"attorney","pre_engagement":true},
    {"phase":"new_lead","name":"Determine fit - proceed or decline","due_offset_days":0,"relative_to":"discovery_call","assignee":"attorney","pre_engagement":true},

    {"phase":"intake_sent","name":"Send post-discovery email (PMPS link + estate plan organizer)","due_offset_days":0,"relative_to":"discovery_call","assignee":"automation","auto":true,"gate":"fit_confirmed","pre_engagement":true},
    {"phase":"intake_sent","name":"Lead schedules Peace of Mind Planning Session","due_offset_days":7,"relative_to":"discovery_call","nudge_offset_days":5,"nudge_tier":"gentle","assignee":"client","gate":"fit_confirmed","pre_engagement":true},
    {"phase":"intake_sent","name":"Lead completes estate plan organizer","due_offset_days":-1,"relative_to":"pmps","nudge_offset_days":-3,"nudge_tier":"gentle","assignee":"client","gate":"fit_confirmed","pre_engagement":true},

    {"phase":"intake_completed","name":"Confirm organizer submitted; follow up if not","due_offset_days":-1,"relative_to":"pmps","assignee":"attorney","pre_engagement":true},
    {"phase":"intake_completed","name":"Run PMPS prep (agenda, proposal, tax worksheet, one-pager)","due_offset_days":-1,"relative_to":"pmps","assignee":"attorney","skill":"pmps-prep","pre_engagement":true},
    {"phase":"intake_completed","name":"Hold Peace of Mind Planning Session","due_offset_days":0,"relative_to":"pmps","assignee":"attorney","pre_engagement":true},

    {"phase":"engagement_sent","name":"Send recommendations + engagement agreement","due_offset_days":1,"relative_to":"pmps","assignee":"attorney","pre_engagement":true},
    {"phase":"engagement_sent","name":"Client signs engagement agreement","due_offset_days":4,"relative_to":"pmps","nudge_offset_days":3,"nudge_tier":"gentle","escalation_offset_days":7,"escalation_tier":"firm","assignee":"client","pre_engagement":true,"triggers_day_zero":true},

    {"phase":"intake","name":"Create matter folder in OneDrive","due_offset_days":0,"assignee":"automation","skill":"new-matter-folder","auto":true},
    {"phase":"intake","name":"Send invoice / collect payment","due_offset_days":0,"assignee":"attorney","skill":"qbo-invoice"},

    {"phase":"design","name":"Send design summary to client","due_offset_days":1,"assignee":"attorney"},
    {"phase":"design","name":"Schedule optional design meeting","due_offset_days":2,"assignee":"attorney","conditional":true},
    {"phase":"design","name":"Hold design meeting","due_offset_days":5,"assignee":"attorney","conditional":true},
    {"phase":"design","name":"Client approves design","due_offset_days":7,"nudge_offset_days":5,"nudge_tier":"gentle","escalation_offset_days":10,"escalation_tier":"firm","assignee":"client","pauses_clock":true},

    {"phase":"drafting","name":"Draft full document package","due_offset_days":13,"nudge_offset_days":11,"nudge_tier":"internal","assignee":"attorney","skill":"draft-estate-plan-documents"},
    {"phase":"drafting","name":"Draft deed(s) if applicable","due_offset_days":14,"assignee":"attorney","skill":"deed-drafting","conditional":true},
    {"phase":"drafting","name":"Internal QA review of all documents","due_offset_days":15,"assignee":"attorney"},
    {"phase":"drafting","name":"Deliver drafts to client for review","due_offset_days":16,"nudge_offset_days":14,"nudge_tier":"internal","assignee":"attorney"},

    {"phase":"client_review","name":"Client reviews drafts and submits feedback","due_offset_days":22,"nudge_offset_days":20,"nudge_tier":"gentle","escalation_offset_days":24,"escalation_tier":"firm","assignee":"client","pauses_clock":true},

    {"phase":"revision","name":"Incorporate revisions (Round 1)","due_offset_days":24,"assignee":"attorney"},
    {"phase":"revision","name":"Deliver revised drafts to client","due_offset_days":24,"assignee":"attorney"},
    {"phase":"revision","name":"Round 2 revision (extends SLA +5 days)","due_offset_days":29,"assignee":"attorney","conditional":true,"extends_target_days":5},

    {"phase":"signing_scheduled","name":"Indicate funding details for each asset in design sheet","due_offset_days":25,"assignee":"attorney"},
    {"phase":"signing_scheduled","name":"Print and tab all documents for signing","due_offset_days":27,"assignee":"attorney"},
    {"phase":"signing_scheduled","name":"Generate final invoice if balance due","due_offset_days":27,"assignee":"attorney","skill":"qbo-invoice","conditional":true},
    {"phase":"signing_scheduled","name":"Generate DIY signing instructions","due_offset_days":25,"assignee":"attorney","conditional":true,"variant":"remote_signing"},
    {"phase":"signing_scheduled","name":"Mail/deliver signing package to client","due_offset_days":25,"assignee":"attorney","conditional":true,"variant":"remote_signing"},
    {"phase":"signing_scheduled","name":"Confirm client received package","due_offset_days":28,"assignee":"attorney","conditional":true,"variant":"remote_signing","pauses_clock":true},
    {"phase":"signing_scheduled","name":"Monitor signing progress until originals returned","due_offset_days":28,"nudge_offset_days":28,"nudge_tier":"gentle","assignee":"attorney","conditional":true,"variant":"remote_signing","pauses_clock":true,"recurring_interval_days":7},

    {"phase":"signing_complete","name":"Signing meeting held","due_offset_days":28,"assignee":"attorney"},
    {"phase":"signing_complete","name":"Supervise execution (clients, notary, witnesses)","due_offset_days":28,"assignee":"attorney"},
    {"phase":"signing_complete","name":"Collect any balance due","due_offset_days":28,"assignee":"attorney","conditional":true},
    {"phase":"signing_complete","name":"Scan signed Certification of Trust; upload to OneDrive","due_offset_days":28,"assignee":"attorney"},
    {"phase":"signing_complete","name":"Review trust funding package with client","due_offset_days":28,"assignee":"attorney","skill":"trust-funding"},
    {"phase":"signing_complete","name":"Originals received; proceed to post-signing","due_offset_days":35,"assignee":"attorney","conditional":true,"variant":"remote_signing"},

    {"phase":"post_execution","name":"Send deeds to county clerk for recording","due_offset_days":29,"assignee":"attorney","conditional":true},
    {"phase":"post_execution","name":"Scan all signed originals; upload to OneDrive","due_offset_days":31,"assignee":"attorney"},
    {"phase":"post_execution","name":"Generate estate plan summary","due_offset_days":33,"assignee":"attorney","skill":"generate-estate-plan-summary"},
    {"phase":"post_execution","name":"Draft closing / funding package","due_offset_days":34,"assignee":"attorney","skill":"trust-funding"},
    {"phase":"post_execution","name":"Deliver closing package to client","due_offset_days":35,"assignee":"attorney"},
    {"phase":"post_execution","name":"Send handwritten thank-you note","due_offset_days":35,"assignee":"attorney"},
    {"phase":"post_execution","name":"File legal plan claim if applicable (MetLife / LegalEASE / ARAG)","due_offset_days":38,"assignee":"attorney","skill":"metlife-claim","conditional":true},

    {"phase":"funding","name":"30-day post-signing funding check-in","due_offset_days":58,"nudge_offset_days":58,"nudge_tier":"gentle","assignee":"attorney","recurring_interval_days":30},
    {"phase":"funding","name":"Confirm recorded deeds received from county","due_offset_days":58,"assignee":"attorney","conditional":true},
    {"phase":"funding","name":"Confirm all assets funded; close matter","due_offset_days":null,"assignee":"attorney"}
  ]'::jsonb
)
on conflict (template_name) do update set
  description                = excluded.description,
  target_days                = excluded.target_days,
  target_days_pre_engagement = excluded.target_days_pre_engagement,
  target_days_engagement     = excluded.target_days_engagement,
  tasks                      = excluded.tasks,
  updated_at                 = now();

notify pgrst, 'reload schema';
