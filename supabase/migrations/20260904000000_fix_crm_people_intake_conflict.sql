-- PostgREST upserts emit ON CONFLICT (client_intake_id) with no WHERE
-- predicate, which cannot infer the partial unique index from
-- 20260901000000. Replace it with a full unique index; NULLs are distinct,
-- so contact-sourced rows (client_intake_id is null) are unaffected.

create unique index cornerstone_crm_people_client_intake_id_key
  on public.cornerstone_crm_people (client_intake_id);

drop index if exists public.cornerstone_crm_people_client_intake_id_idx;
