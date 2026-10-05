-- A revision now decides who signs, not just what the signers are called.
--
-- create_engagement_agreement_revision used to UPDATE the 'primary' and
-- 'spouse' recipient rows in place. An agreement drafted for one client and
-- then switched to a couple in the workspace had no spouse row to update, so
-- the e-signature request went out with one signer; a couple switched to an
-- individual kept the stale spouse row and sent to them anyway.
--
-- The spouse row is now rebuilt from the snapshot on every revision: deleted,
-- and re-inserted when the snapshot names a spouse. Deleting it first also lets
-- a revision move an email between the two signers without tripping
-- unique (agreement_id, email). Revisions are only allowed before sending, so no
-- external recipient id or status is lost. external_recipient_id (the
-- provider-neutral column) is now reset alongside firma_recipient_id.

create or replace function public.create_engagement_agreement_revision(
  p_agreement_id uuid,
  p_input_snapshot jsonb,
  p_render_snapshot jsonb,
  p_render_sha256 text,
  p_master_version text,
  p_html_r2_key text default null,
  p_pdf_r2_key text default null
) returns setof public.engagement_agreement_revisions
language plpgsql set search_path = pg_catalog, public as $$
declare
  agreement_status text;
  next_revision_number integer;
  created_revision public.engagement_agreement_revisions;
  spouse jsonb := nullif(p_input_snapshot->'spouse', 'null'::jsonb);
begin
  select status into agreement_status
  from public.engagement_agreements
  where id = p_agreement_id
  for update;
  if agreement_status is null then
    raise exception 'engagement agreement not found';
  end if;
  if agreement_status not in ('draft', 'ready', 'failed') then
    raise exception 'cannot revise agreement in status %', agreement_status;
  end if;

  select coalesce(max(revision_number), 0) + 1 into next_revision_number
  from public.engagement_agreement_revisions
  where agreement_id = p_agreement_id;

  insert into public.engagement_agreement_revisions (
    agreement_id, revision_number, input_snapshot, render_snapshot,
    render_sha256, master_version, html_r2_key, pdf_r2_key
  ) values (
    p_agreement_id, next_revision_number, p_input_snapshot, p_render_snapshot,
    p_render_sha256, p_master_version, p_html_r2_key, p_pdf_r2_key
  ) returning * into created_revision;

  delete from public.engagement_agreement_recipients
  where agreement_id = p_agreement_id and role = 'spouse';

  update public.engagement_agreement_recipients
  set name = p_input_snapshot->'primary'->>'name',
      email = lower(p_input_snapshot->'primary'->>'email'),
      firma_recipient_id = null, external_recipient_id = null,
      status = 'pending', sent_at = null, viewed_at = null, signed_at = null,
      declined_at = null, last_reminded_at = null, updated_at = now()
  where agreement_id = p_agreement_id and role = 'primary';

  if spouse is not null then
    insert into public.engagement_agreement_recipients (agreement_id, recipient_order, role, name, email)
    values (p_agreement_id, 2, 'spouse', coalesce(spouse->>'name', ''), lower(coalesce(spouse->>'email', '')));
  end if;

  update public.engagement_agreements
  set active_revision_id = created_revision.id, status = 'draft', updated_at = now()
  where id = p_agreement_id;
  return next created_revision;
end;
$$;

revoke execute on function public.create_engagement_agreement_revision(uuid, jsonb, jsonb, text, text, text, text) from public, anon;

notify pgrst, 'reload schema';
