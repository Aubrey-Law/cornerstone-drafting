create table public.engagement_agreements (
  id uuid primary key default gen_random_uuid(),
  matter_id uuid references public.matters(id) on delete cascade,
  lead_id uuid references public.client_intake(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft','ready','sending','sent','viewed','partially_signed','completed','cancelled','expired','failed')),
  active_revision_id uuid,
  firma_request_id text unique,
  legacy_envelope_id text,
  completed_r2_key text,
  prepared_by uuid references auth.users(id),
  sent_by uuid references auth.users(id),
  sent_at timestamptz,
  completed_at timestamptz,
  approval_nonce text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((matter_id is not null)::int + (lead_id is not null)::int = 1)
);

create table public.engagement_agreement_revisions (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references public.engagement_agreements(id) on delete cascade,
  revision_number integer not null,
  input_snapshot jsonb not null,
  render_snapshot jsonb not null,
  render_sha256 text not null,
  master_version text not null,
  html_r2_key text,
  pdf_r2_key text,
  created_at timestamptz not null default now(),
  unique (agreement_id, revision_number),
  unique (agreement_id, render_sha256),
  unique (agreement_id, id)
);

alter table public.engagement_agreements
  add constraint engagement_agreements_active_revision_fkey
  foreign key (id, active_revision_id)
  references public.engagement_agreement_revisions(agreement_id, id);

create table public.engagement_agreement_recipients (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references public.engagement_agreements(id) on delete cascade,
  recipient_order integer not null check (recipient_order > 0),
  role text not null check (role in ('primary', 'spouse')),
  name text not null,
  email text not null,
  firma_recipient_id text,
  status text not null default 'pending' check (status in ('pending','sent','viewed','signed','declined','failed')),
  sent_at timestamptz,
  viewed_at timestamptz,
  signed_at timestamptz,
  declined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agreement_id, recipient_order),
  unique (agreement_id, email)
);

create table public.firma_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  firma_request_id text,
  event_type text not null,
  payload jsonb not null,
  agreement_id uuid references public.engagement_agreements(id) on delete set null,
  processed_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);

create or replace function public.set_engagement_revision_number()
returns trigger language plpgsql as $$
begin
  if new.revision_number is null then
    select coalesce(max(revision_number), 0) + 1 into new.revision_number
    from public.engagement_agreement_revisions where agreement_id = new.agreement_id;
  end if;
  return new;
end;
$$;

create trigger engagement_revision_number_before_insert
before insert on public.engagement_agreement_revisions
for each row execute function public.set_engagement_revision_number();

create or replace function public.guard_engagement_revision_insert()
returns trigger language plpgsql as $$
declare agreement_status text;
begin
  select status into agreement_status
  from public.engagement_agreements
  where id = new.agreement_id
  for update;
  if agreement_status is null then
    raise exception 'engagement agreement not found';
  end if;
  if agreement_status not in ('draft', 'ready', 'failed') then
    raise exception 'cannot revise agreement in status %', agreement_status;
  end if;
  return new;
end;
$$;

create trigger engagement_revision_lifecycle_before_insert
before insert on public.engagement_agreement_revisions
for each row execute function public.guard_engagement_revision_insert();

create or replace function public.create_engagement_agreement_revision(
  p_agreement_id uuid,
  p_input_snapshot jsonb,
  p_render_snapshot jsonb,
  p_render_sha256 text,
  p_master_version text,
  p_html_r2_key text default null,
  p_pdf_r2_key text default null
) returns setof public.engagement_agreement_revisions
language plpgsql set search_path = public as $$
declare
  agreement_status text;
  next_revision_number integer;
  created_revision public.engagement_agreement_revisions;
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

  update public.engagement_agreements
  set active_revision_id = created_revision.id, status = 'draft', updated_at = now()
  where id = p_agreement_id;
  return next created_revision;
end;
$$;

revoke all on function public.create_engagement_agreement_revision(uuid, jsonb, jsonb, text, text, text, text) from public;
grant execute on function public.create_engagement_agreement_revision(uuid, jsonb, jsonb, text, text, text, text) to authenticated, service_role;

create or replace function public.guard_engagement_agreement_status_transition()
returns trigger language plpgsql as $$
begin
  if (
    old.status = 'sending' and new.status in ('draft', 'ready')
  ) or (
    old.status in ('sent', 'viewed', 'partially_signed', 'completed', 'cancelled', 'expired')
    and new.status in ('draft', 'ready', 'failed')
  ) then
    raise exception 'cannot reset agreement from status % to %', old.status, new.status;
  end if;
  return new;
end;
$$;

create trigger engagement_agreement_status_transition_before_update
before update of status on public.engagement_agreements
for each row execute function public.guard_engagement_agreement_status_transition();

create or replace function public.claim_engagement_agreement_send(
  p_agreement_id uuid,
  p_revision_id uuid,
  p_render_sha256 text,
  p_approval_nonce text,
  p_sent_by uuid
) returns setof public.engagement_agreements
language sql security definer set search_path = public as $$
  update public.engagement_agreements a
  set status = 'sending', sent_by = p_sent_by, approval_nonce = p_approval_nonce, updated_at = now()
  from public.engagement_agreement_revisions r
  where a.id = p_agreement_id
    and a.status = 'ready'
    and a.active_revision_id = p_revision_id
    and r.id = p_revision_id
    and r.agreement_id = a.id
    and r.render_sha256 = p_render_sha256
    and a.approval_nonce is null
    and (
      auth.role() = 'service_role'
      or exists (
        select 1 from public.users u
        where u.id = auth.uid()
          and u.id = p_sent_by
          and u.role in ('attorney', 'admin', 'va', 'staff')
      )
    )
  returning a.*;
$$;

revoke all on function public.claim_engagement_agreement_send(uuid, uuid, text, text, uuid) from public;
grant execute on function public.claim_engagement_agreement_send(uuid, uuid, text, text, uuid) to authenticated, service_role;

alter table public.engagement_agreements enable row level security;
alter table public.engagement_agreement_revisions enable row level security;
alter table public.engagement_agreement_recipients enable row level security;
alter table public.firma_webhook_events enable row level security;

create policy "Staff manage engagement agreements" on public.engagement_agreements for all
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('attorney', 'admin', 'va', 'staff')))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('attorney', 'admin', 'va', 'staff')));
create policy "Staff manage engagement revisions" on public.engagement_agreement_revisions for all
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('attorney', 'admin', 'va', 'staff')))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('attorney', 'admin', 'va', 'staff')));
create policy "Staff manage engagement recipients" on public.engagement_agreement_recipients for all
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('attorney', 'admin', 'va', 'staff')))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('attorney', 'admin', 'va', 'staff')));
create policy "Staff manage engagement webhook events" on public.firma_webhook_events for all
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('attorney', 'admin', 'va', 'staff')))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('attorney', 'admin', 'va', 'staff')));

notify pgrst, 'reload schema';
