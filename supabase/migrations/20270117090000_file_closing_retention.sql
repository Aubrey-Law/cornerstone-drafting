-- File closing and retention.
--
-- Closing a matter was two separate moves that did not know about each other:
-- the Close-out card moved the stage to `closed` and stamped a date, while the
-- Matter status dropdown set status `closed` and ran the billing check. Nothing
-- told the client the matter was finished, and nothing said how long the firm
-- would keep the file or when that period ended.
--
-- Now one close does the whole thing (lib/fileClosing/): the billing check,
-- both axes, the closed date, the retention date, and a closing notice to the
-- client offered through the delegation dial. The retention period is a firm
-- setting; each closed file carries the date it ends and a hold that stops the
-- clock. A weekly run lists files past their date for the attorney to review;
-- destruction stays a person's decision and goes through the existing
-- permanent delete, which already logs to matter_deletions.

alter table public.firm_settings
  add column if not exists file_retention_years integer not null default 6
    check (file_retention_years between 1 and 30),
  add column if not exists closing_notice_enabled boolean not null default true;

comment on column public.firm_settings.file_retention_years is
  'How many years after a matter closes the firm keeps its file before it is reviewed for destruction. '
  'Massachusetts Rule of Professional Conduct 1.15A asks for at least six.';

alter table public.matter_details
  add column if not exists retention_until date,
  add column if not exists retention_hold boolean not null default false,
  add column if not exists retention_hold_reason text;

comment on column public.matter_details.retention_until is
  'The day the retention period ends: closed_date plus the firm''s retention years, set when the matter closes. '
  'A weekly run lists files past this date for review; nothing is destroyed automatically.';
comment on column public.matter_details.retention_hold is
  'True while the file must be kept past its retention date (a dispute, a request, an open estate). '
  'A held file is never listed for destruction.';

-- Files closed before this shipped get their retention date from the day they
-- closed, so the review list is complete from the first run.
update public.matter_details md
set retention_until = (md.closed_date + make_interval(years => coalesce(fs.file_retention_years, 6)))::date
from public.firm_settings fs
where fs.id = 1
  and md.retention_until is null
  and md.closed_date is not null;

create index if not exists matter_details_retention_until_idx
  on public.matter_details (retention_until)
  where retention_until is not null;

-- The weekly retention review, on the automation center's control.
insert into public.automation_rules (
  name, description, trigger_key, action_key, mode, approval_policy,
  system_key, origin, schedule_cron, schedule_timezone, locked
)
values
  ('File retention review', 'Each Monday morning, finds closed files whose retention period has ended and are not on hold, and proposes a review task for each so the attorney decides what to destroy.', 'schedule', 'system_job', 'live', 'automatic', 'system:file-retention', 'system_schedule', '40 12 * * 1', 'UTC', true)
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
