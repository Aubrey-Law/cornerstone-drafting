-- Client self-entry of assets, and client-reported retitling with the
-- institution's confirmation attached.
--
-- The funding tracker (asset_funding) was staff-only: staff entered every
-- asset and recorded every step, and a client who had just retitled a bank
-- account had no way to say so or to send the confirmation except by email.
-- Now the portal lists the client's assets with what each one needs, lets the
-- client add an asset the firm does not know about, and lets them upload the
-- institution's confirmation (or say the step is done). What the client
-- reports is never "confirmed" — that word stays with the firm, after someone
-- has read the paper — it is "awaiting confirmation" with the document linked,
-- and a task through the delegation dial to check it.

-- Where the asset came from. Client-entered rows read as such on the matter.
alter table public.asset_intake
  add column if not exists source text not null default 'staff'
    check (source in ('staff', 'client', 'import'));

-- What the client sent and when. The document is the institution's own
-- confirmation, filed to the matter like any client upload.
alter table public.asset_funding
  add column if not exists confirmation_document_id uuid
    references public.matter_documents(id) on delete set null,
  add column if not exists client_reported_at timestamptz,
  add column if not exists client_note text;

create index if not exists asset_funding_confirmation_document_idx
  on public.asset_funding (confirmation_document_id);

-- A client reads the funding state of the assets on their own matter. Writes
-- stay with the service role (the portal routes), as for every other
-- matter-adjacent table here.
drop policy if exists asset_funding_client_select on public.asset_funding;
create policy asset_funding_client_select
  on public.asset_funding for select to authenticated
  using (
    exists (
      select 1
      from public.matters m
      join public.client_intake ci on ci.id = m.client_intake_id
      where m.id = asset_funding.matter_id
        and (ci.user_id = (select auth.uid()) or ci.client_user_id = (select auth.uid()))
    )
  );

grant select on public.asset_funding to authenticated;

comment on column public.asset_funding.confirmation_document_id is
  'The institution''s confirmation the client uploaded (matter_documents). Linked when the client reports a retitling; the firm confirms after reading it.';
comment on column public.asset_funding.client_reported_at is
  'When the client last said this step was done, from the portal.';
comment on column public.asset_intake.source is
  'staff (entered on the matter), client (added from the portal) or import.';

notify pgrst, 'reload schema';
