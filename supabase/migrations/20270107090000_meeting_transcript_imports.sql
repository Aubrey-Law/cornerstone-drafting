-- Meeting transcripts land on their own.
--
-- Until now a Granola note reached a matter or lead only when someone picked
-- it from the "Add meeting notes" dialog, and a Teams meeting's transcript
-- never reached the app at all. The meeting-transcripts sweep
-- (lib/meetings/transcriptSync.ts, /api/cron/meeting-transcripts) now reads
-- both sources every half hour, saves each new note on the matter or lead the
-- meeting belongs to, and hands it to the meeting follow-up, which proposes
-- the design decisions, tasks and client recap through the delegation dial.
--
-- This table is the sweep's ledger: one row per transcript it has looked at,
-- so a note is saved once and a meeting that matched no record is not asked
-- about again on every pass. Written only by the server-side sweep.

create table public.meeting_transcript_imports (
  provider text not null check (provider in ('granola', 'microsoft_teams')),
  external_id text not null check (length(btrim(external_id)) between 1 and 200),
  record_type text not null check (record_type in ('matter', 'lead', 'none')),
  record_id uuid,
  -- The matter document or lead meeting note the transcript became.
  note_id uuid,
  title text,
  meeting_date date,
  -- Why nothing was saved: no_match, ambiguous, matter_not_open, save_failed.
  skipped_reason text,
  actor_id uuid references auth.users(id) on delete set null,
  imported_at timestamptz not null default now(),
  primary key (provider, external_id),
  constraint meeting_transcript_imports_record_check check (
    (record_type = 'none' and record_id is null)
    or (record_type in ('matter', 'lead') and record_id is not null)
  )
);

create index meeting_transcript_imports_record_idx
  on public.meeting_transcript_imports (record_type, record_id, imported_at desc);

alter table public.meeting_transcript_imports enable row level security;
revoke all on table public.meeting_transcript_imports from anon, authenticated;
grant all on table public.meeting_transcript_imports to service_role;

-- The sweep's control row, so the automation center can pause it like any
-- other system job.
insert into public.automation_rules (
  name, description, trigger_key, action_key, mode, approval_policy,
  system_key, origin, schedule_cron, schedule_timezone, locked
)
values
  ('Meeting transcripts', 'Reads new Granola notes and Teams transcripts onto their matter or lead and starts the meeting follow-up.', 'schedule', 'system_job', 'live', 'automatic', 'system:meeting-transcripts', 'system_schedule', '*/30 * * * *', 'UTC', true)
on conflict (system_key) do update set
  name = excluded.name,
  description = excluded.description,
  trigger_key = excluded.trigger_key,
  action_key = excluded.action_key,
  origin = excluded.origin,
  schedule_cron = excluded.schedule_cron,
  schedule_timezone = excluded.schedule_timezone,
  locked = excluded.locked;

NOTIFY pgrst, 'reload schema';
