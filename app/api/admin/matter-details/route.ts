import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/apiAuth'
import { setMatterNumber } from '@/lib/matterNumber'
import { parsePracticeArea } from '@/lib/practiceArea'
import { normalizeTargetSigningDate } from '@/lib/matterDates'
import { legalPlanDisplayName, normalizeMatterBillingType } from '@/lib/billing/billingType'
import { reconcileEngineStageTask } from '@/lib/stage-engine/fireStageTasks'
import { normalizeEngagementSignedAt } from '@/lib/engagementStatus'
import {
  mirrorEngagementToLead,
  syncEngagementSignedAnchor,
  syncEngagementSignedDetails,
} from '@/lib/engagement/signedDate'

// PATCH /api/admin/matter-details
// Body: { matterId: string; field: string; value: unknown }
// Upserts into matter_details using the admin client (bypasses RLS).

// Allowlist of matter_details columns that may be written via this endpoint.
// Prevents accidental writes to system columns (id, client_id, created_at, etc.).
const WRITABLE_FIELDS = new Set([
  // Core / shared
  'practice_area', 'matter_number', 'open_date', 'target_close_date', 'closed_date',
  'scheduled_signing_date', 'signing_date', 'documents_filed_date',
  'flat_fee_amount', 'billing_type', 'est_estate_value', 'tax_exposure',
  'referral_source', 'lawmatics_id', 'clio_matter_number', 'matter_status_notes',
  'iolta_required', 'internal_notes',
  'intake_date', 'hired_date', 'design_meeting_date', 'draft_sent_date',
  'drafts_approved_date', 'client_review_date', 'revisions_sent_date', 'execution_date',
  // V1 — Shared
  'responsible_attorney', 'co_counsel', 'paralegal_assigned',
  'jurisdiction_state', 'jurisdiction_county', 'urgency',
  // V1 — Estate Planning (ep_)
  'trust_funding_status', 'deed_recorded',
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
  'conflict_cleared', 'engagement_signed', 'engagement_status', 'engagement_signed_at',
  'fee_collected', 'fee_collected_date',
  'fee_payment_status',
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
  // V3 — matter page schema coverage
  'referral_source_other',
  'ep_has_real_estate', 'ep_has_pets', 'ep_anticipated_inheritance', 'ep_accounts_retitled',
  'legal_plan_member_id', 'claim_submitted_date',
  'reimbursement_received_date', 'payment_link_sent_at',
  'work_started_date', 'work_finished_date', 'closing_package_sent_date',
  'next_action_date',
])

// Plan composition belongs to the design sheet. The matter page renders these
// read-only and links out; rejecting them here means a stale client, a script
// or a future component cannot quietly create a second source of truth.
const DESIGN_SHEET_OWNED_FIELDS = new Set([
  'plan_type',
  'trust_type',
  'trust_name',
  'credit_shelter_provisions',
  'fiduciary_appointments',
])

/** Columns a stage-task gate reads — a write to any of them re-reconciles. */
const PLAN_GATE_FIELDS = new Set([
  'ep_has_real_estate',
  'ep_has_pets',
  'ep_deed_transfers_needed',
  'ep_separate_trusts',
  'ep_signing_method',
  'billing_type',
])

/**
 * A plan flag decides which items the open stage task carries. Fold the change
 * in now rather than waiting for the next stage entry — a matter already in
 * drafting should pick up the deed the moment real estate is flagged.
 */
async function reconcilePlanGates(
  admin: ReturnType<typeof getAdminClient>,
  matterId: string,
): Promise<void> {
  const { data: matter } = await admin
    .from('matters')
    .select('stage')
    .eq('id', matterId)
    .maybeSingle()
  if (!matter?.stage) return
  try {
    await reconcileEngineStageTask(admin, matterId, matter.stage as string)
  } catch (e) {
    // Never fail the field save because the checklist could not be updated.
    console.error('matter-details plan gate reconcile failed', e)
  }
}

export async function PATCH(req: Request) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const { matterId, field, value, manual } = await req.json()
  if (!matterId || !field) {
    return NextResponse.json({ error: 'matterId and field are required' }, { status: 400 })
  }

  if (DESIGN_SHEET_OWNED_FIELDS.has(field)) {
    return NextResponse.json(
      { error: `"${field}" is owned by the design sheet — edit it there` },
      { status: 400 },
    )
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
  if (field === 'scheduled_signing_date' && normalizedValue !== null) {
    if (typeof normalizedValue !== 'string') {
      return NextResponse.json({ error: 'Invalid target signing date' }, { status: 400 })
    }
    normalizedValue = normalizeTargetSigningDate(normalizedValue)
    if (!normalizedValue) {
      return NextResponse.json({ error: 'Invalid target signing date' }, { status: 400 })
    }
  }

  if (field === 'engagement_status') {
    // The dropdown also covers engagements handled outside the app (or already
    // signed on paper), so a manual status change keeps the legacy
    // engagement_signed / sent_at / signed_at columns consistent, and mirrors
    // onto the originating lead so the Leads pipeline shows the same status.
    const allowed = ['not_sent', 'draft', 'sent', 'signed']
    if (typeof normalizedValue !== 'string' || !allowed.includes(normalizedValue)) {
      return NextResponse.json({ error: 'Invalid engagement status' }, { status: 400 })
    }
    const { data: existing } = await admin
      .from('matter_details')
      .select('engagement_sent_at, engagement_signed_at')
      .eq('client_id', matterId)
      .maybeSingle()
    const now = new Date().toISOString()
    const patch =
      normalizedValue === 'signed'
        ? {
            engagement_status: 'signed',
            engagement_signed: true,
            engagement_signed_at: existing?.engagement_signed_at ?? now,
            engagement_sent_at: existing?.engagement_sent_at ?? null,
          }
        : normalizedValue === 'sent'
          ? {
              engagement_status: 'sent',
              engagement_signed: false,
              engagement_signed_at: null,
              engagement_sent_at: existing?.engagement_sent_at ?? now,
            }
          : {
              engagement_status: normalizedValue === 'draft' ? 'draft' : null,
              engagement_signed: false,
              engagement_signed_at: null,
              engagement_sent_at: null,
            }
    const { data: row, error: statusError } = await admin
      .from('matter_details')
      .upsert({ client_id: matterId, ...patch }, { onConflict: 'client_id' })
      .select()
      .single()
    if (statusError) {
      console.error('matter-details engagement status update failed', { matterId, value, statusError })
      return NextResponse.json({ error: statusError.message }, { status: 500 })
    }
    const leadError = await mirrorEngagementToLead(admin, matterId, {
      engagement_status: patch.engagement_status,
      engagement_sent_at: patch.engagement_sent_at,
      engagement_signed_at: patch.engagement_signed_at,
    })
    if (leadError) return NextResponse.json({ error: leadError }, { status: 500 })
    // Marking the engagement signed starts the same clock the SLA tab anchors.
    const { rescheduled, error: anchorError } = await syncEngagementSignedAnchor(
      admin,
      matterId,
      patch.engagement_signed_at,
    )
    if (anchorError) return NextResponse.json({ error: anchorError }, { status: 500 })
    return NextResponse.json({ row, rescheduled })
  }

  if (field === 'engagement_signed_at') {
    // Engagements signed on paper, or in another system, never reach the e-sign
    // webhook — the attorney records the date here instead. It is the same fact
    // the status dropdown and the SLA tab's key dates write, so it lands in all
    // three places and re-dates the tasks hanging off the engagement clock.
    const normalized = normalizeEngagementSignedAt(normalizedValue)
    if (!normalized.ok) {
      return NextResponse.json(
        { error: 'Engagement signed date must be a date (YYYY-MM-DD) or empty' },
        { status: 400 },
      )
    }
    const { row, error: detailsError } = await syncEngagementSignedDetails(
      admin,
      matterId,
      normalized.value,
    )
    if (detailsError) return NextResponse.json({ error: detailsError }, { status: 500 })
    const { rescheduled, error: anchorError } = await syncEngagementSignedAnchor(
      admin,
      matterId,
      normalized.value,
    )
    if (anchorError) return NextResponse.json({ error: anchorError }, { status: 500 })
    return NextResponse.json({ row, rescheduled })
  }

  if (field === 'billing_type') {
    // One enum for how a matter is paid; legal_plan follows it as the display
    // name so the two columns can never disagree again.
    const normalized = normalizeMatterBillingType(normalizedValue)
    if (normalizedValue !== null && !normalized) {
      return NextResponse.json({ error: 'Invalid billing type' }, { status: 400 })
    }
    const { data: row, error: billingError } = await admin
      .from('matter_details')
      .upsert(
        {
          client_id: matterId,
          billing_type: normalized,
          legal_plan: legalPlanDisplayName(normalized),
        },
        { onConflict: 'client_id' },
      )
      .select()
      .single()
    if (billingError) {
      console.error('matter-details billing type update failed', { matterId, value, billingError })
      return NextResponse.json({ error: billingError.message }, { status: 500 })
    }
    await reconcilePlanGates(admin, matterId)
    return NextResponse.json({ row })
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

  if (PLAN_GATE_FIELDS.has(field)) await reconcilePlanGates(admin, matterId)

  return NextResponse.json({ row: data })
}
