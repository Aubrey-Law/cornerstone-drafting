alter table public.client_intake
  add column if not exists lead_source text;

create table public.lead_activity (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.client_intake(id) on delete cascade,
  event_type text not null,
  title text not null,
  detail text,
  actor_id uuid references auth.users(id) on delete set null,
  source_matter_activity_id uuid references public.matter_activity(id) on delete set null,
  created_at timestamptz not null default now()
);

create index lead_activity_lead_created_idx on public.lead_activity (lead_id, created_at desc);
alter table public.lead_activity enable row level security;
create policy "Staff read lead activity" on public.lead_activity for select to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('attorney','admin','va','staff')));
create policy "Staff add lead activity" on public.lead_activity for insert to authenticated
  with check (actor_id = auth.uid() and exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('attorney','admin','va','staff')));
create policy "Authors or admins delete lead notes" on public.lead_activity for delete to authenticated
  using (event_type = 'note' and (actor_id = auth.uid() or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')));

create table public.engagement_clause_library (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('additional_clause','schedule_a')),
  title text not null,
  approved_text text not null,
  practice_areas text[] not null default array['EP']::text[],
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.engagement_clause_library enable row level security;
create policy "Staff read engagement clauses" on public.engagement_clause_library for select to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('attorney','admin','va','staff')));
create policy "Attorneys manage engagement clauses" on public.engagement_clause_library for all to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('attorney','admin')))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('attorney','admin')));

grant select, insert, delete on public.lead_activity to authenticated;
grant select, insert, update, delete on public.engagement_clause_library to authenticated;
notify pgrst, 'reload schema';
;
