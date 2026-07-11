import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizePracticeArea, practiceAreaLabel } from '@/lib/practiceArea'
import { ensureDesignSheetSeededFromIntake } from '@/lib/designSheet/ensureDesignSheetSeeded'
import { generateUniqueMatterNumber } from '@/lib/matterNumber'

/**
 * Convert a standalone lead (a client_intake row with no matter) into a
 * matter, carrying over the intake, quoted fee, and engagement state. Used
 * by the e-sign webhook (auto-convert on signing) and the Leads page's
 * manual Create matter action. Mirrors app/api/admin/matters/create but
 * attaches the EXISTING intake instead of inserting a fresh one.
 */
export async function createMatterFromIntake(
  admin: SupabaseClient,
  intakeId: string,
  options: { actorId?: string | null } = {},
): Promise<{ ok: true; matterId: string; matterNumber: string } | { ok: false; error: string }> {
  interface LeadIntakeRow {
    id: string
    email: string | null
    first_name: string | null
    last_name: string | null
    full_name: string | null
    practice_area: string | null
    user_id: string | null
    client_user_id: string | null
    engagement_provider: string | null
    engagement_envelope_id: string | null
    engagement_status: string | null
    engagement_sent_at: string | null
    engagement_signed_at: string | null
    engagement_fee_quoted: number | null
    lead_status: string | null
  }
  const { data: intakeData, error: intakeError } = await admin
    .from('client_intake')
    .select(
      'id, email, first_name, last_name, full_name, practice_area, user_id, client_user_id, engagement_provider, engagement_envelope_id, engagement_status, engagement_sent_at, engagement_signed_at, engagement_fee_quoted, lead_status',
    )
    .eq('id', intakeId)
    .maybeSingle()
  if (intakeError) return { ok: false, error: intakeError.message }
  const intake = intakeData as LeadIntakeRow | null
  if (!intake) return { ok: false, error: 'Lead not found' }

  // Idempotency: if a matter already references this intake, return it.
  const { data: existing } = await admin
    .from('matters')
    .select('id, matter_number')
    .eq('client_intake_id', intakeId)
    .maybeSingle()
  if (existing) {
    return { ok: true, matterId: existing.id, matterNumber: existing.matter_number ?? '' }
  }

  const clientName =
    intake.full_name?.trim() ||
    [intake.first_name, intake.last_name].filter(Boolean).join(' ').trim() ||
    intake.email ||
    'Client'
  const practiceArea = normalizePracticeArea(intake.practice_area)
  const practiceAreaName = practiceAreaLabel(practiceArea)

  const matterNumber = await generateUniqueMatterNumber(admin, {
    year: new Date().getFullYear(),
    practiceArea,
    clientLastName: intake.last_name ?? null,
    clientFirstName: intake.first_name ?? clientName,
  })
  const now = new Date().toISOString()

  const { data: matter, error: matterError } = await admin
    .from('matters')
    .insert({
      client_intake_id: intakeId,
      client_id: intake.client_user_id ?? intake.user_id ?? null,
      name: `${clientName} — ${practiceAreaName}`,
      matter_number: matterNumber,
      stage: 'intake',
      status: 'active',
      stage_entered_at: now,
      track: 'DEFAULT',
    })
    .select('id')
    .single()
  if (matterError || !matter) {
    return { ok: false, error: `Failed to create matter: ${matterError?.message ?? 'unknown'}` }
  }

  // Flag the source lead as Hired (only if it went through the lead flow;
  // matter-origin intakes have a null lead_status and shouldn't appear as leads).
  await admin
    .from('client_intake')
    .update({ matter_id: matter.id, lead_status: intake.lead_status ? 'hired' : intake.lead_status })
    .eq('id', intakeId)

  const feeQuoted =
    typeof intake.engagement_fee_quoted === 'number' && Number.isFinite(intake.engagement_fee_quoted)
      ? intake.engagement_fee_quoted
      : null
  const engagementSigned = intake.engagement_status === 'signed'

  const { error: detailsError } = await admin.from('matter_details').upsert(
    {
      client_id: matter.id,
      practice_area: practiceArea,
      plan_type: 'TBD',
      matter_status: 'Active',
      client_status: 'active',
      jurisdiction_state: 'MA',
      matter_number: matterNumber,
      ...(feeQuoted != null ? { flat_fee_amount: feeQuoted } : {}),
      ...(intake.engagement_envelope_id
        ? {
            engagement_provider: intake.engagement_provider ?? null,
            engagement_envelope_id: intake.engagement_envelope_id,
            engagement_status: intake.engagement_status ?? null,
            engagement_sent_at: intake.engagement_sent_at ?? null,
            engagement_signed_at: intake.engagement_signed_at ?? null,
          }
        : {}),
      ...(engagementSigned ? { engagement_signed: true } : {}),
    },
    { onConflict: 'client_id' },
  )
  if (detailsError) {
    return { ok: false, error: `Failed to create matter details: ${detailsError.message}` }
  }

  try {
    await ensureDesignSheetSeededFromIntake(matter.id)
  } catch (e) {
    console.warn('design sheet seed on lead conversion skipped:', e)
  }

  try {
    await admin.from('matter_activity').insert({
      matter_id: matter.id,
      event_type: 'matter_created',
      title: 'Matter created from lead',
      detail: `${clientName} (${intake.email ?? 'no email'})`,
      actor_id: options.actorId ?? null,
    })
  } catch (e) {
    console.warn('matter_activity skipped:', e)
  }

  return { ok: true, matterId: matter.id, matterNumber }
}
