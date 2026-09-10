-- A concurrency token for design-sheet saves.
--
-- `saveLiDesignSheet` in the root app writes with no version check at all, so
-- two tabs open on one matter means the second save silently discards the
-- first — on a legal design sheet.
--
-- NOT `version`, which already exists. 20260813000001 states the invariant it
-- carries: "one design sheet per (matter_id, version)". Incrementing it per
-- save would redefine a documented column.
--
-- NOT a row per save either, elegant as that would be — the unique constraint
-- would give compare-and-swap for free and real revision history with it. But
-- 26 files touch design_sheets and only 10 order by version, and several call
-- `.maybeSingle()`, which throws rather than reading stale once a second
-- version exists. That is a 16-file audit, not a persistence change.
--
-- Defaulted, so every existing row is valid immediately and no backfill runs.
alter table public.design_sheets
  add column if not exists lock_version integer not null default 0;

comment on column public.design_sheets.lock_version is
  'Optimistic-concurrency token. Callers pass the value they read; the update increments it and matches on it, so a save against a stale read affects no rows. Distinct from `version`, which identifies the sheet revision.';

notify pgrst, 'reload schema';
