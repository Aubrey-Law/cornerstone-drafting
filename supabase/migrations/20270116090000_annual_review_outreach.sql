-- Annual review outreach as a campaign.
--
-- A year after a plan is signed, the client should hear from the firm: life
-- changes (a marriage, a birth, a move, a new account) are what make a plan
-- stale, and the firm only learns of them if it asks. Until now "annual
-- review" was one internal task on the matter and nothing ever reached the
-- client; the rule that created it skipped closed matters, which are exactly
-- the audience.
--
-- Now a daily run finds every signed estate plan whose review is coming due
-- (the anchor is the execution date; the first review after a configurable
-- number of months, then on a cadence), drafts the client's email with a link
-- to book a review call, records the cycle here, and offers the send through
-- the delegation dial. One row per matter per cycle; the unique key is what
-- stops a second run from asking twice.

alter table public.firm_settings
  add column if not exists annual_review_outreach_enabled boolean not null default false,
  add column if not exists annual_review_months_after_signing integer not null default 12
    check (annual_review_months_after_signing between 1 and 60),
  add column if not exists annual_review_cadence_months integer not null default 12
    check (annual_review_cadence_months between 1 and 60),
  add column if not exists annual_review_lead_days integer not null default 14
    check (annual_review_lead_days between 0 and 120);

-- A client who asked not to be contacted about reviews, or whose plan the
-- firm no longer maintains. Per matter, set on the matter page.
alter table public.matter_details
  add column if not exists annual_review_opt_out boolean not null default false;

create table if not exists public.annual_review_outreach (
  id            uuid primary key default gen_random_uuid(),
  matter_id     uuid not null references public.matters(id) on delete cascade,
  -- The review this outreach is for: the anchor plus the configured months,
  -- then each cadence after. One outreach per matter per due date.
  cycle_due_on  date not null,
  status        text not null default 'drafted'
    check (status in ('drafted', 'sent', 'skipped', 'failed')),
  to_email      text not null,
  subject       text not null,
  body_text     text not null,
  body_html     text not null,
  booking_url   text,
  sent_at       timestamptz,
  sent_by       uuid references auth.users(id) on delete set null,
  -- The portal message that carried the same words, when the client has an account.
  message_id    uuid references public.messages(id) on delete set null,
  error         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (matter_id, cycle_due_on)
);

create index if not exists annual_review_outreach_matter_idx
  on public.annual_review_outreach (matter_id, cycle_due_on desc);

alter table public.annual_review_outreach enable row level security;

drop policy if exists annual_review_outreach_staff_all on public.annual_review_outreach;
create policy annual_review_outreach_staff_all
  on public.annual_review_outreach for all to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = (select auth.uid()) and u.role in ('attorney', 'admin')
    )
  )
  with check (
    exists (
      select 1 from public.users u
      where u.id = (select auth.uid()) and u.role in ('attorney', 'admin')
    )
  );

grant select, insert, update, delete on public.annual_review_outreach to authenticated;

comment on table public.annual_review_outreach is
  'Annual review outreach to clients with a signed plan, one row per matter per review '
  'cycle: the email as drafted, whether it was sent, and the portal message that carried '
  'it. See lib/annualReview/.';

-- The daily run, on the automation center's control (paused or dry-run from
-- there like every other system automation).
insert into public.automation_rules (
  name, description, trigger_key, action_key, mode, approval_policy,
  system_key, origin, schedule_cron, schedule_timezone, locked
)
values
  ('Annual review outreach', 'Each weekday morning, finds signed plans whose annual review is coming due, drafts the client''s review email with a booking link, and offers the send through the delegation dial.', 'schedule', 'system_job', 'live', 'automatic', 'system:annual-review-outreach', 'system_schedule', '20 12 * * 1-5', 'UTC', true)
on conflict (system_key) do update set
  name = excluded.name,
  description = excluded.description,
  trigger_key = excluded.trigger_key,
  action_key = excluded.action_key,
  origin = excluded.origin,
  schedule_cron = excluded.schedule_cron,
  schedule_timezone = excluded.schedule_timezone,
  locked = excluded.locked;

notify pgrst, 'reload schema';
