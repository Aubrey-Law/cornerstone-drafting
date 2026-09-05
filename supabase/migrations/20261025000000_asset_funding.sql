-- Per-asset funding tracking: whether each asset is actually inside the plan.
--
-- An unfunded trust is the largest malpractice exposure in this practice. The
-- documents are right, the client believes they are protected, and the assets
-- pass through probate anyway because nobody changed the title. Nothing here
-- tracked that: `matter_details.trust_funding_status` is one word for a whole
-- matter, and a whole-matter word cannot tell you which account was missed.
--
-- Three decisions in this table are load-bearing.

create table if not exists public.asset_funding (
  id uuid primary key default gen_random_uuid(),

  -- 1. Keyed by (matter, asset) rather than by asset alone. One client intake
  --    can carry more than one hired matter — a re-engagement, a second plan —
  --    and funding is relative to the instrument being funded, not to the
  --    asset in the abstract.
  matter_id uuid not null references public.matters(id) on delete cascade,
  asset_intake_id uuid not null references public.asset_intake(id) on delete cascade,

  method text not null default 'undecided'
    check (method = any (array['undecided', 'deed', 'retitle', 'beneficiary', 'assignment', 'none_required'])),

  status text not null default 'not_started'
    check (status = any (array['not_started', 'in_progress', 'awaiting_confirmation', 'confirmed', 'not_applicable'])),

  -- The date proof was received, not the date the paperwork was sent.
  confirmed_on date,
  note text,

  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (matter_id, asset_intake_id),

  -- 2. Confirmed without a date is a claim with no evidence behind it. The
  --    whole point of the tracker is the difference between "we sent the form"
  --    and "the institution acted on it", so the database refuses to record the
  --    second without saying when.
  constraint asset_funding_confirmed_needs_date
    check (status <> 'confirmed' or confirmed_on is not null)
);

create index if not exists asset_funding_matter_idx on public.asset_funding (matter_id);
create index if not exists asset_funding_asset_idx on public.asset_funding (asset_intake_id);

comment on table public.asset_funding is
  'One row per asset per matter: how that asset joins the plan and how far along it is. The unfunded total is derived from these rows joined to asset_intake.value.';
comment on column public.asset_funding.confirmed_on is
  'When confirmation was received. Required for status=confirmed: sent is not funded.';

-- 3. Retitling a retirement account into a revocable trust is not a transfer,
--    it is a distribution — the entire account becomes taxable income that
--    year. Such accounts join the plan by beneficiary designation instead.
--
--    This is enforced here as well as in the application because it is the one
--    mistake in this table that cannot be undone by editing a row: by the time
--    it is recorded, someone has already filed the paperwork. A check
--    constraint cannot see the asset's category, which lives on another table,
--    so it is a trigger.
create or replace function public.assert_retirement_funding_method()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category text;
begin
  if new.method not in ('deed', 'retitle') then
    return new;
  end if;

  select a.category into v_category
  from public.asset_intake a
  where a.id = new.asset_intake_id;

  if v_category = 'retirement' then
    raise exception
      'A retirement account cannot be funded by % — retitling an IRA or 401(k) into a revocable trust is a taxable distribution of the whole account. Use a beneficiary designation.',
      new.method
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists asset_funding_method_check on public.asset_funding;
create trigger asset_funding_method_check
  before insert or update of method, asset_intake_id on public.asset_funding
  for each row execute function public.assert_retirement_funding_method();

-- Staff read; writes go through the service-role admin client, matching every
-- other matter-adjacent table here.
alter table public.asset_funding enable row level security;

drop policy if exists "Staff read asset funding" on public.asset_funding;
create policy "Staff read asset funding" on public.asset_funding
  for select to authenticated
  using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role in ('admin', 'attorney', 'va', 'staff')
    )
  );
