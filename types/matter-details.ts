/**
 * MatterDetailsRow — matches the `matter_details` table schema
 * from supabase/migrations/20260406_matter_details.sql.
 *
 * This is the canonical UI/server type for the editable matter detail surface.
 * Matter-number is merged in from `matters`; intake timestamps are merged from
 * `client_intake` for setup/readiness display.
 */
export interface MatterDetailsRow {
  id?: string
  client_id?: string
  created_at?: string
  updated_at?: string
  practice_area?: string | null

  // ── Core / shared ──
  matter_number?: string | null
  matter_type?: string | null
  open_date?: string | null
  target_close_date?: string | null
  closed_date?: string | null
  scheduled_signing_date?: string | null
  signing_date?: string | null
  documents_filed_date?: string | null
  flat_fee_amount?: number | null
  billing_type?: string | null
  est_estate_value?: number | null
  tax_exposure?: string | null
  plan_type?: string | null
  referral_source?: string | null
  lawmatics_id?: string | null
  clio_matter_number?: string | null
  matter_status_notes?: string | null
  iolta_required?: boolean | null
  internal_notes?: string | null
  intake_sent_at?: string | null
  intake_completed_at?: string | null
  // Timeline dates
  intake_date?: string | null
  hired_date?: string | null
  design_meeting_date?: string | null
  draft_sent_date?: string | null
  drafts_approved_date?: string | null
  client_review_date?: string | null
  revisions_sent_date?: string | null
  execution_date?: string | null

  // ── V1 — Shared ──
  responsible_attorney?: string | null
  co_counsel?: string | null
  paralegal_assigned?: string | null
  jurisdiction_state?: string | null
  jurisdiction_county?: string | null
  urgency?: string | null

  // ── V1 — Estate Planning (ep_) ──
  trust_type?: string | null
  credit_shelter_provisions?: string | null
  trust_funding_status?: string | null
  deed_recorded?: boolean | null
  ep_plan_category?: string | null
  ep_trust_type?: string | null
  ep_ancillary_docs?: { doc_type?: string | null; status?: string | null; notes?: string | null }[] | null
  ep_funding_status?: string | null
  ep_deed_transfers_needed?: boolean | null
  ep_beneficiary_updates_needed?: boolean | null
  ep_powers_of_attorney_status?: string | null
  ep_healthcare_proxy_status?: string | null
  ep_has_prenuptial?: boolean | null
  ep_prior_plan_date?: string | null
  ep_prior_plan_firm?: string | null
  ep_special_provisions?: string | null

  // ── V1 — Probate (pb_) ──
  pb_decedent_name?: string | null
  pb_date_of_death?: string | null
  pb_testate_intestate?: string | null
  pb_probate_type?: string | null
  pb_court_name?: string | null
  pb_docket_number?: string | null
  pb_personal_representative?: string | null
  pb_pr_appointment_date?: string | null
  pb_inventory_due_date?: string | null
  pb_inventory_filed_date?: string | null
  pb_claims_period_end_date?: string | null
  pb_706_due_date?: string | null
  pb_706_filed_date?: string | null
  pb_m706_due_date?: string | null
  pb_m706_filed_date?: string | null
  pb_fiduciary_return_due_date?: string | null
  pb_fiduciary_return_filed_date?: string | null
  pb_final_distribution_date?: string | null
  pb_estimated_close_date?: string | null
  pb_estate_closed?: boolean | null
  pb_estate_closed_date?: string | null
  pb_federal_estate_tax_required?: boolean | null
  pb_state_estate_tax_required?: boolean | null
  pb_bond_amount?: number | null
  pb_bond_waived_in_will?: boolean | null

  // ── V2 — Shared ──
  conflict_check_completed?: boolean | null
  conflict_check_date?: string | null
  conflict_cleared?: boolean | null
  engagement_signed?: boolean | null
  engagement_provider?: string | null
  engagement_envelope_id?: string | null
  engagement_status?: string | null
  engagement_sent_at?: string | null
  engagement_signed_at?: string | null
  fee_collected?: boolean | null
  fee_collected_date?: string | null
  fee_payment_status?: 'unpaid' | 'deposit' | 'paid_in_full' | null

  // ── V2 — EP Document Tracking ──
  ep_living_will_status?: string | null
  ep_hipaa_auth_status?: string | null
  ep_signing_method?: string | null
  ep_witness_required?: boolean | null
  ep_funding_complete_date?: string | null

  // ── V2 — EP Tax / Strategy ──
  ep_ma_estate_taxable?: boolean | null
  ep_ma_estate_tax_savings?: number | null
  ep_separate_trusts?: boolean | null
  ep_has_ilit?: boolean | null
  ep_ilit_trustee?: string | null

  // ── V2 — Probate Parties ──
  pb_surviving_spouse?: boolean | null
  pb_surviving_spouse_name?: string | null
  pb_elective_share_claimed?: boolean | null
  pb_has_minor_beneficiaries?: boolean | null
  pb_beneficiary_count?: number | null
  pb_heir_count?: number | null

  // ── V2 — Probate Property ──
  pb_qualifies_small_estate?: boolean | null
  pb_real_property_parcel_count?: number | null
  pb_ancillary_probate_required?: boolean | null
  pb_ancillary_probate_state?: string | null

  // ── Status + Legal Plan ──
  matter_status?: string | null
  /** Display name derived from `billing_type` — never an independent answer. */
  legal_plan?: string | null
  legal_plan_id?: string | null
  legal_plan_type?: string | null
  legal_plan_service_start?: string | null
  legal_plan_service_end?: string | null
  client_status?: string | null

  // ── V3 — Matter page schema coverage ──
  // See supabase/migrations/20260903000000_matter_page_schema_coverage.sql.
  /** Free text behind the "Other" option on the referral picklist. */
  referral_source_other?: string | null
  ep_has_real_estate?: boolean | null
  ep_has_pets?: boolean | null
  ep_anticipated_inheritance?: boolean | null
  ep_accounts_retitled?: boolean | null
  legal_plan_member_id?: string | null
  /**
   * @deprecated The plan claim's amount is the matter's `plan_claim` billing
   * item. This column is no longer read or written; it is retained so historical
   * rows survive, and it is absent from the matter-details writable allowlist.
   */
  claim_amount?: number | null
  claim_submitted_date?: string | null
  reimbursement_received_date?: string | null
  payment_link_sent_at?: string | null
  work_started_date?: string | null
  work_finished_date?: string | null
  closing_package_sent_date?: string | null
  /** Drives the header pill and the weekly ops board. */
  next_action_date?: string | null
}
