import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/apiAuth'
import { setMatterNumber } from '@/lib/matterNumber'
import { parsePracticeArea } from '@/lib/practiceArea'

// PATCH /api/admin/matter-details
// Body: { matterId: string; field: string; value: unknown }
// Upserts into matter_details using the admin client (bypasses RLS).

// Allowlist of matter_details columns that may be written via this endpoint.
// Prevents accidental writes to system columns (id, client_id, created_at, etc.).
const WRITABLE_FIELDS = new Set([
  // Core / shared
  'practice_area', 'matter_number', 'open_date', 'target_close_date', 'closed_date',
  'scheduled_signing_date', 'signing_date', 'documents_filed_date',
  'flat_fee_amount', 'billing_type', 'est_estate_value', 'tax_exposure', 'plan_type',
  'referral_source', 'lawmatics_id', 'clio_matter_number', 'matter_status_notes',
  'iolta_required', 'internal_notes',
  'intake_date', 'hired_date', 'design_meeting_date', 'draft_sent_date',
  'drafts_approved_date', 'client_review_date', 'revisions_sent_date', 'execution_date',
  // V1 — Shared
  'responsible_attorney', 'co_counsel', 'paralegal_assigned',
  'jurisdiction_state', 'jurisdiction_county', 'urgency',
  // V1 — Estate Planning (ep_)
  'trust_type', 'credit_shelter_provisions', 'trust_funding_status', 'deed_recorded',
  'ep_plan_category', 'ep_trust_type', 'ep_ancillary_docs',
  'ep_funding_status', 'ep_deed_transfers_needed', 'ep_beneficiary_updates_needed',
  'ep_powers_of_attorney_status', 'ep_healthcare_proxy_status',
  'ep_has_prenuptial', 'ep_prior_plan_date', 'ep_prior_plan_firm',
  'ep_special_provisions',
  // V1 — Probate (pb_)
  'pb_decedent_name', 'pb_date_of_death', 'pb_testate_intestate',
  'pb_probate_type', 'pb_court_name', 'pb_docket_number',
  'pb_personal_representative', 'pb_pr_appointment_date',
  'pb_inventory_due_date', 'pb_inventory_filed_date',
  'pb_claims_period_end_date', 'pb_706_due_date', 'pb_706_filed_date',
  'pb_m706_due_date', 'pb_m706_filed_date',
  'pb_fiduciary_return_due_date', 'pb_fiduciary_return_filed_date',
  'pb_final_distribution_date', 'pb_estimated_close_date',
  'pb_estate_closed', 'pb_estate_closed_date',
  'pb_federal_estate_tax_required', 'pb_state_estate_tax_required',
  'pb_bond_amount', 'pb_bond_waived_in_will',
  // V2 — Shared
  'conflict_check_completed', 'conflict_check_date',
  'conflict_cleared', 'engagement_signed',
  'fee_collected', 'fee_collected_date',
  // V2 — EP Document Tracking
  'ep_living_will_status', 'ep_hipaa_auth_status',
  'ep_signing_method', 'ep_witness_required', 'ep_funding_complete_date',
  // V2 — EP Tax / Strategy
  'ep_ma_estate_taxable', 'ep_ma_estate_tax_savings',
  'ep_separate_trusts', 'ep_has_ilit', 'ep_ilit_trustee',
  // V2 — Probate Parties
  'pb_surviving_spouse', 'pb_surviving_spouse_name',
  'pb_elective_share_claimed', 'pb_has_minor_beneficiaries',
  'pb_beneficiary_count', 'pb_heir_count',
  // V2 — Probate Property
  'pb_qualifies_small_estate', 'pb_real_property_parcel_count',
  'pb_ancillary_probate_required', 'pb_ancillary_probate_state',
  // Status + Legal Plan
  'matter_status', 'legal_plan', 'legal_plan_id', 'legal_plan_type',
  'legal_plan_service_start', 'legal_plan_service_end', 'client_status',
])

export async function PATCH(req: Request) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const { matterId, field, value, manual } = await req.json()
  if (!matterId || !field) {
    return NextResponse.json({ error: 'matterId and field are required' }, { status: 400 })
  }

  if (!WRITABLE_FIELDS.has(field)) {
    return NextResponse.json({ error: `Field "${field}" is not writable` }, { status: 400 })
  }

  const admin = getAdminClient()
  let normalizedValue = value === '' ? null : value
  if (field === 'practice_area' && normalizedValue !== null) {
    normalizedValue = parsePracticeArea(normalizedValue)
    if (!normalizedValue) {
      return NextResponse.json({ error: 'Invalid practice area' }, { status: 400 })
    }
  }

  if (field === 'matter_number') {
    // matter_number lives on two tables; setMatterNumber keeps them in sync.
    try {
      const row = await setMatterNumber(admin, matterId, normalizedValue, {
        manual: manual === false ? false : true,
      })
      return NextResponse.json({ row })
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Save failed' }, { status: 500 })
    }
  }

  // Use upsert with onConflict: 'client_id' — handles both insert and update atomically.
  // The UNIQUE constraint on client_id makes this safe with no race condition.
  const { data, error } = await admin
    .from('matter_details')
    .upsert(
      { client_id: matterId, [field]: normalizedValue },
      { onConflict: 'client_id' }
    )
    .select()
    .single()

  if (error) {
    console.error('matter-details upsert failed', { matterId, field, value, error })
    const detail = [error.message, error.details, error.hint, error.code]
      .filter(Boolean)
      .join(' — ')
    return NextResponse.json({ error: detail || 'Unknown DB error' }, { status: 500 })
  }

  if (field === 'plan_type') {
    const { data: matter } = await admin
      .from('matters')
      .select('client_intake_id')
      .eq('id', matterId)
      .maybeSingle()
    if (matter?.client_intake_id) {
      const { error: intakeErr } = await admin
        .from('client_intake')
        .update({ plan_type: normalizedValue })
        .eq('id', matter.client_intake_id)
      if (intakeErr) {
        return NextResponse.json({ error: intakeErr.message }, { status: 500 })
      }
    }
  }

  return NextResponse.json({ row: data })
}
