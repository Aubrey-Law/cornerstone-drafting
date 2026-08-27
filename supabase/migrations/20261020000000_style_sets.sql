-- Document formatting as stored configuration rather than a constant.
--
-- Until now the generator's styling was one line — `BODY_FONT_NAME =
-- 'Garamond'` in lib/estateGenerator/node/templateRenderer.ts — and everything
-- else the firm's house style asks for was applied by hand, per document, after
-- generation. `lib/styleSets/` replaced that constant with a settings object;
-- this is where those objects live.
--
-- The `settings` blob is validated by `parseStyleSetSettings` in
-- lib/styleSets/schema.ts, not by a CHECK constraint. That is deliberate: the
-- schema treats an absent field as "preserve whatever the template had", so a
-- row written before a field existed must keep rendering rather than fail. A
-- CHECK would turn every future field into a migration of every existing row.
--
-- `source_*` records the .docx a style set was derived from, when it was
-- derived from one rather than typed in. Kept as provenance — the settings are
-- the source of truth for rendering, and a style set with no file behind it is
-- perfectly valid.

create table if not exists public.style_sets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  settings jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  source_file_name text,
  source_r2_key text,
  source_size_bytes bigint,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.style_sets is
  'Reusable document formatting. `settings` is parsed by parseStyleSetSettings() in lib/styleSets/schema.ts and applied by applyStyleSetToPart() at generation time.';
comment on column public.style_sets.settings is
  'StyleSetSettings as JSON. Absent keys mean "preserve the template''s own value", so older rows stay valid as the schema grows.';
comment on column public.style_sets.deleted_at is
  'Soft delete. A generated document records which style set produced it, so a hard delete would strip the provenance from work already delivered.';

-- At most one default among live rows. A unique index over a column that is
-- true for every row it indexes is the standard way to say "at most one".
create unique index if not exists style_sets_one_default
  on public.style_sets (is_default)
  where is_default and deleted_at is null;

-- Names are how staff pick a style set in the UI, so two live rows called
-- "House style" would be a coin flip. Case-insensitive, because "House Style"
-- and "House style" are the same mistake.
create unique index if not exists style_sets_name_unique
  on public.style_sets (lower(name))
  where deleted_at is null;

create index if not exists style_sets_live
  on public.style_sets (updated_at desc)
  where deleted_at is null;

drop trigger if exists set_updated_at_style_sets on public.style_sets;
create trigger set_updated_at_style_sets
  before update on public.style_sets
  for each row execute function public.set_updated_at();

-- Staff read; writes go through the service-role admin client, matching how
-- every other firm-configuration table here is governed.
alter table public.style_sets enable row level security;

drop policy if exists "Staff read style sets" on public.style_sets;
create policy "Staff read style sets" on public.style_sets
  for select to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role in ('admin', 'attorney', 'va', 'staff')
    )
  );
