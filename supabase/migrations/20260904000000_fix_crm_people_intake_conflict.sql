-- PostgREST upserts emit ON CONFLICT (client_intake_id) with no WHERE
-- predicate, which cannot infer the partial unique index from
-- 20260901000000. Replace it with a full unique index; NULLs are distinct,
-- so contact-sourced rows (client_intake_id is null) are unaffected.

-- `if not exists`: this was applied to the cornerstone project out of band,
-- and the tool that ran it logged its own wall-clock version rather than this
-- file's, so a later `db push` still sees this migration as pending. Replaying
-- it must be a no-op instead of failing on "relation already exists".
create unique index if not exists cornerstone_crm_people_client_intake_id_key
  on public.cornerstone_crm_people (client_intake_id);

drop index if exists public.cornerstone_crm_people_client_intake_id_idx;
