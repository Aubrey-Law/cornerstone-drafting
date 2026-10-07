-- The fiduciary ledger: what a probate estate owned at death, and every dollar
-- that moved through it afterwards.
--
-- A personal representative accounts to the court for the estate: the
-- inventory at date-of-death values, then receipts, gains and losses on sales,
-- expenses and claims paid, and distributions, ending in the balance on hand.
-- Until now none of it lived in the app; it was a spreadsheet beside the
-- matter. Two tables hold it, and lib/estateLedger/model.ts computes the
-- account from them.
--
-- Money is integer cents. Nothing here is the firm's money or a trust account:
-- it is a record of the estate's own funds, kept by the firm for the
-- representative. See docs/operations/estate-ledger.md.

-- The inventory. One row per asset the decedent owned at death.
create table if not exists public.estate_assets (
  id uuid primary key default gen_random_uuid(),
  matter_id uuid not null references public.matters(id) on delete cascade,
  description text not null check (length(description) between 1 and 500),
  category text not null default 'other'
    check (category in ('real_estate', 'bank', 'investment', 'retirement', 'insurance', 'vehicle', 'personal_property', 'business', 'receivable', 'other')),
  -- Probate property is on the inventory and the account. Non-probate property
  -- (joint, beneficiary-designated, trust) is listed so the estate is seen
  -- whole, and stays out of the account.
  probate boolean not null default true,
  date_of_death_value_cents bigint not null default 0 check (date_of_death_value_cents >= 0),
  valuation_note text check (valuation_note is null or length(valuation_note) <= 1000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists estate_assets_matter_idx on public.estate_assets (matter_id, created_at);

-- Everything that happened after death, in date order.
--   receipt       money in that was not on the inventory (income, refunds, a late asset)
--   disbursement  money out for the estate: expenses, taxes, creditor claims, fees
--   sale          an inventory asset sold; amount is the net proceeds, and the
--                 gain or loss is measured against its inventory value
--   distribution  to a beneficiary: cash, or an inventory asset in kind
--                 (asset_id set, amount is its inventory value)
create table if not exists public.estate_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  matter_id uuid not null references public.matters(id) on delete cascade,
  entry_date date not null,
  kind text not null check (kind in ('receipt', 'disbursement', 'sale', 'distribution')),
  -- Principal and income are accounted separately on a fiduciary account.
  fund text not null default 'principal' check (fund in ('principal', 'income')),
  amount_cents bigint not null check (amount_cents >= 0),
  description text not null check (length(description) between 1 and 500),
  -- Who paid the estate, or who the estate paid.
  counterparty text check (counterparty is null or length(counterparty) <= 200),
  asset_id uuid references public.estate_assets(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  -- A sale is always of an inventory asset; a receipt or disbursement never is.
  constraint estate_ledger_entries_asset_check check (
    (kind = 'sale' and asset_id is not null)
    or (kind in ('receipt', 'disbursement') and asset_id is null)
    or kind = 'distribution'
  )
);

create index if not exists estate_ledger_entries_matter_idx on public.estate_ledger_entries (matter_id, entry_date, created_at);

-- An asset leaves the estate once: sold or distributed, not both, not twice.
create unique index if not exists estate_ledger_entries_asset_disposal_idx
  on public.estate_ledger_entries (asset_id)
  where asset_id is not null;

alter table public.estate_assets enable row level security;
alter table public.estate_ledger_entries enable row level security;

drop policy if exists estate_assets_staff_all on public.estate_assets;
create policy estate_assets_staff_all on public.estate_assets
  for all to authenticated
  using (exists (select 1 from public.users u where u.id = (select auth.uid()) and u.role in ('attorney', 'admin')))
  with check (exists (select 1 from public.users u where u.id = (select auth.uid()) and u.role in ('attorney', 'admin')));

drop policy if exists estate_ledger_entries_staff_all on public.estate_ledger_entries;
create policy estate_ledger_entries_staff_all on public.estate_ledger_entries
  for all to authenticated
  using (exists (select 1 from public.users u where u.id = (select auth.uid()) and u.role in ('attorney', 'admin')))
  with check (exists (select 1 from public.users u where u.id = (select auth.uid()) and u.role in ('attorney', 'admin')));

grant select, insert, update, delete on public.estate_assets to authenticated;
grant select, insert, update, delete on public.estate_ledger_entries to authenticated;

comment on table public.estate_assets is
  'Probate inventory: each asset the decedent owned at death, at date-of-death value. See lib/estateLedger/.';
comment on table public.estate_ledger_entries is
  'Fiduciary ledger: receipts, disbursements, sales and distributions after death. See lib/estateLedger/.';

notify pgrst, 'reload schema';
