-- Payroll for the firm's one owner-employee (S corp, Massachusetts).
--
-- Payroll ran from a spreadsheet: a Setup tab of rates, a Register row per pay
-- date, quarterly totals for Form 941 and the Massachusetts DUA and PFML
-- filings, a deadline list, a journal entry per payroll and checklists. These
-- tables hold the same records so the app can compute each paycheck, track the
-- deposits and filings, print a pay stub, and export the journal for Mercury
-- Accounting. The arithmetic lives in lib/payroll; nothing here calculates.
--
-- Money is integer cents; rates are decimal fractions (0.062 = 6.2%). A run's
-- `computed` column is a snapshot of every figure on the check. Drafts are
-- recomputed when settings change; a finalized run keeps its snapshot, so a
-- later rate edit cannot rewrite a check that has already been paid.
--
-- Payroll is the owner's own pay and tax data, so reads are limited to the
-- `admin` role (not every attorney), and writes go through the service role.

create table if not exists public.payroll_settings (
  tax_year                       integer primary key check (tax_year between 2000 and 2100),
  pay_periods_per_year           integer not null default 12 check (pay_periods_per_year between 1 and 53),
  prior_wages_cents              bigint not null default 0 check (prior_wages_cents >= 0),
  fed_wh_per_check_cents         bigint not null default 0 check (fed_wh_per_check_cents >= 0),
  ma_exemption_cents             bigint not null default 440000 check (ma_exemption_cents >= 0),
  ma_income_tax_rate             numeric(9,6) not null default 0.05 check (ma_income_tax_rate between 0 and 1),
  ss_rate                        numeric(9,6) not null default 0.062 check (ss_rate between 0 and 1),
  ss_wage_base_cents             bigint not null default 18450000 check (ss_wage_base_cents >= 0),
  medicare_rate                  numeric(9,6) not null default 0.0145 check (medicare_rate between 0 and 1),
  addl_medicare_rate             numeric(9,6) not null default 0.009 check (addl_medicare_rate between 0 and 1),
  addl_medicare_threshold_cents  bigint not null default 20000000 check (addl_medicare_threshold_cents >= 0),
  futa_rate                      numeric(9,6) not null default 0.006 check (futa_rate between 0 and 1),
  futa_wage_base_cents           bigint not null default 700000 check (futa_wage_base_cents >= 0),
  ma_ui_rate                     numeric(9,6) not null default 0.0242 check (ma_ui_rate between 0 and 1),
  ma_wtf_rate                    numeric(9,6) not null default 0.00056 check (ma_wtf_rate between 0 and 1),
  ma_emac_rate                   numeric(9,6) not null default 0 check (ma_emac_rate between 0 and 1),
  ma_covid_rate                  numeric(9,6) not null default 0 check (ma_covid_rate between 0 and 1),
  ma_ui_wage_base_cents          bigint not null default 1500000 check (ma_ui_wage_base_cents >= 0),
  pfml_employee_rate             numeric(9,6) not null default 0.0046 check (pfml_employee_rate between 0 and 1),
  pfml_employer_rate             numeric(9,6) not null default 0 check (pfml_employer_rate between 0 and 1),
  -- Null: the Social Security wage base, as the workbook does.
  pfml_wage_cap_cents            bigint check (pfml_wage_cap_cents >= 0),
  employer_name                  text not null default '',
  employer_ein                   text not null default '',
  employee_name                  text not null default '',
  employee_address               text not null default '',
  -- Never the full number.
  employee_ssn_last4             text not null default '' check (employee_ssn_last4 ~ '^([0-9]{4})?$'),
  rates_confirmed_at             timestamptz,
  created_at                     timestamptz not null default now(),
  updated_at                     timestamptz not null default now()
);

comment on table public.payroll_settings is
  'One row per tax year: the owner-employee payroll rates, wage bases and per-check federal withholding (the workbook''s Setup tab). See lib/payroll.';

create table if not exists public.payroll_runs (
  id                     uuid primary key default gen_random_uuid(),
  tax_year               integer not null check (tax_year between 2000 and 2100),
  pay_date               date not null,
  gross_cents            bigint not null check (gross_cents > 0),
  fed_wh_override_cents  bigint check (fed_wh_override_cents >= 0),
  computed               jsonb not null default '{}'::jsonb,
  status                 text not null default 'draft' check (status in ('draft', 'finalized')),
  finalized_at           timestamptz,
  net_paid_on            date,
  fed_deposit_paid_on    date,
  eftps_confirmation     text,
  ma_deposit_paid_on     date,
  notes                  text,
  calendar_event_id      text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (tax_year, pay_date),
  check (extract(year from pay_date)::integer = tax_year)
);

create index if not exists payroll_runs_year_date_idx on public.payroll_runs (tax_year, pay_date);

comment on table public.payroll_runs is
  'One row per pay date (the workbook''s Register). `computed` is the paycheck snapshot; a finalized run keeps it. See lib/payroll/calc.ts.';

create table if not exists public.payroll_filings (
  id                 uuid primary key default gen_random_uuid(),
  tax_year           integer not null check (tax_year between 2000 and 2100),
  key                text not null,
  due_date           date not null,
  done_on            date,
  confirmation       text,
  notes              text,
  calendar_event_id  text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (tax_year, key)
);

comment on table public.payroll_filings is
  'Payroll filing and remittance deadlines per tax year (941, 940, W-2/W-3, MA DUA, MA PFML, MA annual) and when each was done. See lib/payroll/deadlines.ts.';

create table if not exists public.payroll_checklist_items (
  id          uuid primary key default gen_random_uuid(),
  tax_year    integer not null check (tax_year between 2000 and 2100),
  scope       text not null check (scope in ('setup', 'payroll', 'quarter', 'year')),
  item_key    text not null,
  -- A run id for the per-payroll list, the quarter number for the quarterly
  -- list, and '' for the once-a-year lists.
  period_ref  text not null default '',
  done_at     timestamptz not null default now(),
  unique (tax_year, scope, item_key, period_ref)
);

comment on table public.payroll_checklist_items is
  'Ticked payroll checklist items; a row exists only while the item is done. See lib/payroll/checklists.ts.';

do $$
declare
  t text;
begin
  foreach t in array array['payroll_settings', 'payroll_runs', 'payroll_filings', 'payroll_checklist_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (exists (select 1 from public.users u where u.id = (select auth.uid()) and u.role = ''admin''))',
      t || '_admin_select', t
    );
  end loop;
end
$$;

notify pgrst, 'reload schema';
