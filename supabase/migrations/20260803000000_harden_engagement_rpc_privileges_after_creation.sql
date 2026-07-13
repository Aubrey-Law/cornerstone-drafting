-- Reapply engagement RPC privilege and search-path hardening after the
-- engagement schema migration has created every referenced function.

revoke execute on function public.create_engagement_agreement_revision(uuid, jsonb, jsonb, text, text, text, text) from public, anon;
revoke execute on function public.mark_engagement_agreement_ready(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.claim_engagement_agreement_send(uuid, uuid, text, text, uuid) from public, anon;
revoke execute on function public.claim_engagement_agreement_resume(uuid, text, uuid) from public, anon;

alter function public.create_engagement_agreement_revision(uuid, jsonb, jsonb, text, text, text, text) set search_path = pg_catalog, public;
alter function public.mark_engagement_agreement_ready(uuid, uuid, text) set search_path = pg_catalog, public;
alter function public.claim_engagement_agreement_send(uuid, uuid, text, text, uuid) set search_path = pg_catalog, public;
alter function public.claim_engagement_agreement_resume(uuid, text, uuid) set search_path = pg_catalog, public;
alter function public.set_engagement_revision_number() set search_path = pg_catalog, public;
alter function public.guard_engagement_revision_insert() set search_path = pg_catalog, public;
alter function public.guard_engagement_revision_mutation() set search_path = pg_catalog, public;
alter function public.guard_engagement_agreement_status_transition() set search_path = pg_catalog, public;

revoke execute on function public.set_engagement_revision_number() from public, anon, authenticated;
revoke execute on function public.guard_engagement_revision_insert() from public, anon, authenticated;
revoke execute on function public.guard_engagement_revision_mutation() from public, anon, authenticated;
revoke execute on function public.guard_engagement_agreement_status_transition() from public, anon, authenticated;

notify pgrst, 'reload schema';
