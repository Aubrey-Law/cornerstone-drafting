-- Add the matter_details columns the app already types and writes.
--
-- types/matter-details.ts and the PATCH allowlist in
-- app/api/admin/matter-details/route.ts carry 26 fields that exist only in the
-- archived portal migration chain (migrations_archive/portal/20260406000134
-- and 20260428093000) — the greenfield baseline never re-created them. Every
-- save that touches one (the facts-panel couple/individual selector via
-- matter_type, the whole probate essentials card, conflict check, EP document
-- tracking) fails with an unknown-column error, and the draft-payload read in
-- lib/draftPayload/assemble.ts selects ep_ancillary_docs / ep_ilit_trustee,
-- which nulls the entire matter_details result for document generation.
--
-- Types mirror the archived definitions. Status/enum columns deliberately
-- carry no CHECK constraints — validation lives in the app allowlists, and a
-- constraint here would reject legacy spellings normalizers already accept
-- (e.g. matter_type 'joint' → 'couple' in lib/matter/matterType.ts).

alter table public.matter_details
  -- Core / shared
  add column if not exists matter_type text,
  add column if not exists clio_matter_number text,

  -- EP document + strategy tracking
  add column if not exists ep_ancillary_docs jsonb default '[]',
  add column if not exists ep_living_will_status text,
  add column if not exists ep_hipaa_auth_status text,
  add column if not exists ep_witness_required boolean default false,
  add column if not exists ep_funding_complete_date date,
  add column if not exists ep_ilit_trustee text,

  -- Conflict check
  add column if not exists conflict_check_completed boolean default false,
  add column if not exists conflict_check_date date,

  -- Probate timeline
  add column if not exists pb_pr_appointment_date date,
  add column if not exists pb_inventory_filed_date date,
  add column if not exists pb_claims_period_end_date date,
  add column if not exists pb_706_due_date date,
  add column if not exists pb_706_filed_date date,
  add column if not exists pb_m706_due_date date,
  add column if not exists pb_m706_filed_date date,
  add column if not exists pb_fiduciary_return_due_date date,
  add column if not exists pb_fiduciary_return_filed_date date,
  add column if not exists pb_final_distribution_date date,
  add column if not exists pb_estimated_close_date date,
  add column if not exists pb_estate_closed_date date,

  -- Probate parties / property
  add column if not exists pb_bond_amount numeric,
  add column if not exists pb_beneficiary_count integer,
  add column if not exists pb_heir_count integer,
  add column if not exists pb_real_property_parcel_count integer;

comment on column public.matter_details.matter_type is
  'individual | couple — gates the spouse surfaces, joint trusts and second-death provisions (lib/matter/matterType.ts). Falls back to marital status when null.';
comment on column public.matter_details.ep_ancillary_docs is
  'JSON array of ancillary document tracking objects: { "doc_type": string, "status": string, "notes": string }.';
comment on column public.matter_details.pb_bond_amount is
  'Dollar amount of the surety bond required by the court.';

notify pgrst, 'reload schema';
