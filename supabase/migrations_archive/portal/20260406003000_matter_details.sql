-- ============================================================
-- MATTER DETAILS — SUPABASE SCHEMA
-- Aubrey Law Portal
--
-- Consolidates all matter_details migrations applied manually
-- between 2026-04-03 and 2026-04-06:
--   matter_details_migration_v1  (49 columns — shared, ep_, pb_)
--   matter_details_migration_v2  (26 columns — conflict check, doc tracking, tax, parties, property)
--   matter_details_add_status_lp_fields
--   matter_details_add_client_status
--   matter_details_add_date_fields   (type-only fix promoted to schema)
--
-- All ALTER TABLE statements use ADD COLUMN IF NOT EXISTS.
-- Safe to re-run on a clean database.
-- ============================================================


-- ── BASE TABLE ────────────────────────────────────────────────
-- client_id is the FK to matters.id (column name is legacy — it stores
-- the matter UUID, not a contacts/users UUID).

create table if not exists matter_details (
  id                      uuid primary key default gen_random_uuid(),
  client_id               uuid not null references matters(id) on delete cascade,
  practice_area           text,
  -- Original date/plan columns present before migration v1
  open_date               date,
  target_close_date       date,
  closed_date             date,
  scheduled_signing_date  date,
  signing_date            date,
  documents_filed_date    date,
  -- Legacy fee/plan fields
  flat_fee_amount         numeric,
  est_estate_value        numeric,
  tax_exposure            text,
  plan_type               text,
  referral_source         text,
  lawmatics_id            text,
  internal_notes          text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (client_id)
);


-- ── MIGRATION V1 — SHARED ─────────────────────────────────────

alter table matter_details
  add column if not exists responsible_attorney    text,
  add column if not exists co_counsel              text,
  add column if not exists paralegal_assigned      text,
  add column if not exists jurisdiction_state      text,
  add column if not exists jurisdiction_county     text,
  add column if not exists urgency                 text;


-- ── MIGRATION V1 — ESTATE PLANNING (ep_) ──────────────────────

alter table matter_details
  add column if not exists ep_plan_category              text,
  add column if not exists ep_trust_type                 text,
  add column if not exists ep_ancillary_docs             jsonb,
  add column if not exists ep_funding_status             text,
  add column if not exists ep_deed_transfers_needed      boolean,
  add column if not exists ep_beneficiary_updates_needed boolean,
  add column if not exists ep_powers_of_attorney_status  text,
  add column if not exists ep_healthcare_proxy_status    text,
  add column if not exists ep_has_prenuptial             boolean,
  add column if not exists ep_prior_plan_date            date,
  add column if not exists ep_prior_plan_firm            text,
  add column if not exists ep_special_provisions         text;


-- ── MIGRATION V1 — PROBATE (pb_) ──────────────────────────────

alter table matter_details
  add column if not exists pb_decedent_name               text,
  add column if not exists pb_date_of_death               date,
  add column if not exists pb_testate_intestate           text,
  add column if not exists pb_probate_type                text,
  add column if not exists pb_court_name                  text,
  add column if not exists pb_docket_number               text,
  add column if not exists pb_personal_representative     text,
  add column if not exists pb_pr_appointment_date         date,
  add column if not exists pb_inventory_due_date          date,
  add column if not exists pb_inventory_filed_date        date,
  add column if not exists pb_claims_period_end_date      date,
  add column if not exists pb_706_due_date                date,
  add column if not exists pb_706_filed_date              date,
  add column if not exists pb_m706_due_date               date,
  add column if not exists pb_m706_filed_date             date,
  add column if not exists pb_fiduciary_return_due_date   date,
  add column if not exists pb_fiduciary_return_filed_date date,
  add column if not exists pb_final_distribution_date     date,
  add column if not exists pb_estimated_close_date        date,
  add column if not exists pb_estate_closed               boolean,
  add column if not exists pb_estate_closed_date          date,
  add column if not exists pb_federal_estate_tax_required boolean,
  add column if not exists pb_state_estate_tax_required   boolean,
  add column if not exists pb_bond_amount                 numeric,
  add column if not exists pb_bond_waived_in_will         boolean;


-- ── MIGRATION V2 — SHARED ─────────────────────────────────────

alter table matter_details
  add column if not exists conflict_check_completed boolean,
  add column if not exists conflict_check_date      date,
  add column if not exists fee_collected            boolean,
  add column if not exists fee_collected_date       date;


-- ── MIGRATION V2 — EP DOCUMENT TRACKING ───────────────────────

alter table matter_details
  add column if not exists ep_living_will_status    text,
  add column if not exists ep_hipaa_auth_status     text,
  add column if not exists ep_signing_method        text,
  add column if not exists ep_witness_required      boolean,
  add column if not exists ep_funding_complete_date date;


-- ── MIGRATION V2 — EP TAX / STRATEGY ──────────────────────────

alter table matter_details
  add column if not exists ep_ma_estate_taxable     boolean,
  add column if not exists ep_ma_estate_tax_savings numeric,
  add column if not exists ep_separate_trusts       boolean,
  add column if not exists ep_has_ilit              boolean,
  add column if not exists ep_ilit_trustee          text;


-- ── MIGRATION V2 — PROBATE PARTIES ────────────────────────────

alter table matter_details
  add column if not exists pb_surviving_spouse        boolean,
  add column if not exists pb_surviving_spouse_name   text,
  add column if not exists pb_elective_share_claimed  boolean,
  add column if not exists pb_has_minor_beneficiaries boolean,
  add column if not exists pb_beneficiary_count       integer,
  add column if not exists pb_heir_count              integer;


-- ── MIGRATION V2 — PROBATE PROPERTY ───────────────────────────

alter table matter_details
  add column if not exists pb_qualifies_small_estate     boolean,
  add column if not exists pb_real_property_parcel_count integer,
  add column if not exists pb_ancillary_probate_required boolean,
  add column if not exists pb_ancillary_probate_state    text;


-- ── STATUS + LEGAL PLAN FIELDS ────────────────────────────────

alter table matter_details
  add column if not exists matter_status  text,
  add column if not exists legal_plan     text,
  add column if not exists legal_plan_id  text,
  add column if not exists client_status  text;


-- ── BACKFILL: practice_area from client_intake ────────────────
-- Populates practice_area for rows where it is null.
-- Assumes client_intake has a matter_id FK to matters.

update matter_details md
set    practice_area = ci.practice_area
from   matters m
join   client_intake ci on ci.matter_id = m.id
where  md.client_id = m.id
  and  md.practice_area is null
  and  ci.practice_area is not null;


-- ── INDEXES ───────────────────────────────────────────────────

create index if not exists matter_details_client_id_idx
  on matter_details(client_id);


-- ── RLS ───────────────────────────────────────────────────────

alter table matter_details enable row level security;

-- Attorney: full access (admin client bypasses RLS for writes; this covers
-- any future direct-session reads from the attorney portal).
drop policy if exists "attorneys_full_access_matter_details" on matter_details;
create policy "attorneys_full_access_matter_details"
  on matter_details for all
  using (
    (select email from auth.users where id = auth.uid()) = 'scott@aubreylegal.com'
  )
  with check (
    (select email from auth.users where id = auth.uid()) = 'scott@aubreylegal.com'
  );

-- Clients: read-only access to their own row.
-- Clients identify themselves via matters.client_user_id = auth.uid().
-- The /drafts folder exclusion is enforced at the document query layer, not here.
drop policy if exists "clients_read_own_matter_details" on matter_details;
create policy "clients_read_own_matter_details"
  on matter_details for select
  using (
    exists (
      select 1 from matters m
      where m.id = matter_details.client_id
        and m.client_user_id = auth.uid()
    )
  );
