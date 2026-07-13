-- This migration predates the migration that creates these functions. Hosted
-- databases that already had the engagement schema could apply it, but a clean
-- local database could not. Keep it safe for both histories; the post-creation
-- hardening migration reapplies these settings after the functions exist.
do $$
begin
  if to_regprocedure('public.create_engagement_agreement_revision(uuid,jsonb,jsonb,text,text,text,text)') is not null then
    execute 'revoke execute on function public.create_engagement_agreement_revision(uuid, jsonb, jsonb, text, text, text, text) from public, anon';
  end if;
  if to_regprocedure('public.mark_engagement_agreement_ready(uuid,uuid,text)') is not null then
    execute 'revoke execute on function public.mark_engagement_agreement_ready(uuid, uuid, text) from public, anon, authenticated';
  end if;
  if to_regprocedure('public.claim_engagement_agreement_send(uuid,uuid,text,text,uuid)') is not null then
    execute 'revoke execute on function public.claim_engagement_agreement_send(uuid, uuid, text, text, uuid) from public, anon';
  end if;
  if to_regprocedure('public.claim_engagement_agreement_resume(uuid,text,uuid)') is not null then
    execute 'revoke execute on function public.claim_engagement_agreement_resume(uuid, text, uuid) from public, anon';
  end if;

  if to_regprocedure('public.set_engagement_revision_number()') is not null then
    execute 'alter function public.set_engagement_revision_number() set search_path = pg_catalog, public';
  end if;
  if to_regprocedure('public.guard_engagement_revision_insert()') is not null then
    execute 'alter function public.guard_engagement_revision_insert() set search_path = pg_catalog, public';
  end if;
  if to_regprocedure('public.guard_engagement_revision_mutation()') is not null then
    execute 'alter function public.guard_engagement_revision_mutation() set search_path = pg_catalog, public';
  end if;
  if to_regprocedure('public.guard_engagement_agreement_status_transition()') is not null then
    execute 'alter function public.guard_engagement_agreement_status_transition() set search_path = pg_catalog, public';
  end if;
end;
$$;

notify pgrst, 'reload schema';
