revoke execute on function public.create_engagement_agreement_revision(uuid, jsonb, jsonb, text, text, text, text) from anon;
revoke execute on function public.mark_engagement_agreement_ready(uuid, uuid, text) from anon, authenticated;
revoke execute on function public.claim_engagement_agreement_send(uuid, uuid, text, text, uuid) from anon;
revoke execute on function public.claim_engagement_agreement_resume(uuid, text, uuid) from anon;

alter function public.set_engagement_revision_number() set search_path = public;
alter function public.guard_engagement_revision_insert() set search_path = public;
alter function public.guard_engagement_revision_mutation() set search_path = public;
alter function public.guard_engagement_agreement_status_transition() set search_path = public;

notify pgrst, 'reload schema';
