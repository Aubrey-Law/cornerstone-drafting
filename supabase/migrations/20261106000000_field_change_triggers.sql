-- A prompt can fire when a field changes, not only when a stage is entered.
--
-- Why not a second table: a field trigger's dedup key is
-- (matter_id, prompt_id, <the moment it fired>) -- the same shape as a stage
-- trigger's, with the same pending/claimed/done/skipped lifecycle and the same
-- drain path. Only the cause differs.
--
-- And the drain path already handles both, which was checked rather than
-- assumed: materialiseStageTrigger reads exactly id, matter_id and prompt_id
-- off a claimed row. It never reads to_stage, and nothing in the app does
-- outside one test fixture. So a field trigger becomes a run through existing
-- code with no change to it, and relaxing to_stage costs nothing.
--
-- This is the opposite call to the one made for the task emitters one slice
-- earlier, where planFiduciaryEmit was deliberately kept separate from
-- planEmit. Those two answer the same shape of question with different logic
-- over different sources. Here the logic is identical.

alter table public.prompt_stage_triggers
  alter column to_stage drop not null;

alter table public.prompt_stage_triggers
  add column if not exists on_field text;

-- Exactly one cause. A row with neither says nothing about why it exists; a row
-- with both would make the reason ambiguous to anyone reading it later.
alter table public.prompt_stage_triggers
  drop constraint if exists prompt_stage_triggers_one_cause;

alter table public.prompt_stage_triggers
  add constraint prompt_stage_triggers_one_cause
  check ((to_stage is null) <> (on_field is null));

-- The column's meaning is now wider than its name, and the name stays. It
-- holds whichever moment caused the row: a stage's stage_entered_at, or the
-- transaction timestamp of the edit that changed a watched field. Renaming it
-- would mean recreating the unique index that backs this queue's
-- de-duplication, on a working path, for cosmetic gain.
comment on column public.prompt_stage_triggers.stage_entered_at is
  'The moment that caused this trigger: a matter''s stage_entered_at for a '
  'stage trigger, or the transaction timestamp of the edit for an on_field '
  'trigger. Part of the uniqueness that de-duplicates two writes of the same '
  'change.';

comment on column public.prompt_stage_triggers.on_field is
  'The allow-listed source key whose change fired this, or null for a stage '
  'trigger. Exactly one of on_field and to_stage is set.';

-- What declares that a prompt watches a field. Nothing fires unless it says
-- so, so adding this changes nothing about the prompts that already exist.
alter table public.prompts
  add column if not exists fires_on_field_change text[] not null default '{}';

comment on column public.prompts.fires_on_field_change is
  'Allow-listed source keys (see packages/citations/src/prompt/inputs.ts) whose '
  'change fires this prompt. Deliberately not column names: a prompt author '
  'should not be able to widen what a prompt watches by typing.';

-- Fires on a real change to the notes, so re-saving a sheet that did not touch
-- them inserts nothing. An insert counts: a sheet created with notes already in
-- it has notes worth reading, and nothing else would ever notice.
--
-- now() is the dedup timestamp, not the sheet's updated_at. design_sheets has
-- no triggers at all and nothing maintains updated_at on update, so every edit
-- of a sheet would share one frozen insert-time value -- and the unique
-- constraint would have suppressed every re-audit after the first, forever,
-- while looking exactly like de-duplication working. now() is the transaction
-- timestamp: two writes in one transaction fire once, a later edit fires
-- again.
create or replace function public.trg_design_sheets_fire_field_prompts()
returns trigger language plpgsql security definer set search_path = pg_catalog, public
as $$
begin
  insert into public.prompt_stage_triggers (matter_id, prompt_id, on_field, stage_entered_at, status)
  select new.matter_id, p.id, 'design_sheet.drafting_notes', now(), 'pending'
  from public.prompts p
  where 'design_sheet.drafting_notes' = any (p.fires_on_field_change)
  on conflict (matter_id, prompt_id, stage_entered_at) do nothing;
  return null;
end;
$$;

drop trigger if exists trg_design_sheets_fire_field_prompts on public.design_sheets;
drop trigger if exists trg_design_sheets_fire_field_prompts_insert on public.design_sheets;
drop trigger if exists trg_design_sheets_fire_field_prompts_update on public.design_sheets;

-- Two triggers over one function, not one trigger over both events. The single
-- combined trigger this was first written as is rejected outright:
--
--   after insert or update of drafting_notes ... when (new.drafting_notes is
--   distinct from old.drafting_notes or old.id is null)
--   ERROR: INSERT trigger's WHEN condition cannot reference OLD values
--
-- Postgres validates the WHEN condition against every event the trigger
-- declares, and an INSERT has no OLD row, so `old.id is null` -- the clause
-- that was meant to let the insert case through -- cannot be written there at
-- all. Splitting is the only way to give the two events different conditions:
-- an insert needs none, and an update needs one.
create trigger trg_design_sheets_fire_field_prompts_insert
  after insert on public.design_sheets
  for each row
  execute function public.trg_design_sheets_fire_field_prompts();

-- The `of drafting_notes` narrows which updates are considered and the `when`
-- decides among those: saving a sheet without touching the notes is not a
-- change to them, and firing on it would re-audit a matter every time any
-- unrelated field on the sheet was saved.
create trigger trg_design_sheets_fire_field_prompts_update
  after update of drafting_notes on public.design_sheets
  for each row
  when (new.drafting_notes is distinct from old.drafting_notes)
  execute function public.trg_design_sheets_fire_field_prompts();

notify pgrst, 'reload schema';
