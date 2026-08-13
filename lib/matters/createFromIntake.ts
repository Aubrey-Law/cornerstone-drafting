import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizePracticeArea, practiceAreaLabel } from '@/lib/practiceArea'
import { isCollegePrepIntake } from '@/lib/intakeTrack'
import { ensureDesignSheetSeededFromIntake } from '@/lib/designSheet/ensureDesignSheetSeeded'
import { generateUniqueMatterNumber } from '@/lib/matterNumber'
import { applySlaAnchor, ensureMatterSlaTasks } from '@/lib/slaTasks/generate'
import { firmDateKey } from '@/lib/firmDate'

/**
 * Hire the opportunity matter linked to an intake, carrying over the quoted
 * fee and engagement state. Used by the e-sign webhook and the Leads page's
 * manual hire action. The database operation is idempotent and assigns the
 * official matter number only on the first successful hire transition.
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
    intake_track: string | null
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
      'id, email, first_name, last_name, full_name, practice_area, intake_track, user_id, client_user_id, engagement_provider, engagement_envelope_id, engagement_status, engagement_sent_at, engagement_signed_at, engagement_fee_quoted, lead_status',
    )
    .eq('id', intakeId)
    .maybeSingle()
  if (intakeError) return { ok: false, error: intakeError.message }
  const intake = intakeData as LeadIntakeRow | null
  if (!intake) return { ok: false, error: 'Lead not found' }

  const clientName =
    intake.full_name?.trim() ||
    [intake.first_name, intake.last_name].filter(Boolean).join(' ').trim() ||
    intake.email ||
    'Client'
  // A lead that answered the College Preparation Plan questionnaire converts
  // into a CP matter, whatever practice area the lead record carried — the
  // questionnaire is the more specific statement of what was sold, and the
  // design sheet's plan track follows the practice area from here on.
  const practiceArea = isCollegePrepIntake({ intake_track: intake.intake_track })
    ? ('CP' as const)
    : normalizePracticeArea(intake.practice_area)
  const practiceAreaName = practiceAreaLabel(practiceArea)

  const matterNumber = await generateUniqueMatterNumber(admin, {
    year: new Date().getFullYear(),
    practiceArea,
    clientLastName: intake.last_name ?? null,
    clientFirstName: intake.first_name ?? clientName,
  })
  const feeQuoted =
    typeof intake.engagement_fee_quoted === 'number' && Number.isFinite(intake.engagement_fee_quoted)
      ? intake.engagement_fee_quoted
      : null
  const engagementSigned = intake.engagement_status === 'signed'
  const { data: conversionData, error: conversionError } = await admin.rpc('convert_lead_to_matter', {
    p_lead_id: intakeId,
    p_matter_number: matterNumber,
    p_matter_name: `${clientName} — ${practiceAreaName}`,
    p_practice_area: practiceArea,
    p_client_id: intake.client_user_id ?? intake.user_id ?? null,
    p_fee: feeQuoted,
    p_engagement_provider: intake.engagement_provider ?? null,
    p_engagement_envelope_id: intake.engagement_envelope_id ?? null,
    p_engagement_status: intake.engagement_status ?? null,
    p_engagement_sent_at: intake.engagement_sent_at ?? null,
    p_engagement_signed_at: intake.engagement_signed_at ?? null,
    p_engagement_signed: engagementSigned,
    p_actor_id: options.actorId ?? null,
  })
  if (conversionError) return { ok: false, error: conversionError.message }
  const conversion = Array.isArray(conversionData) ? conversionData[0] : conversionData
  if (!conversion?.matter_id) return { ok: false, error: 'Conversion returned no matter' }
  const matterId = conversion.matter_id as string
  const resolvedMatterNumber = (conversion.matter_number as string | null) ?? matterNumber

  try {
    await ensureDesignSheetSeededFromIntake(matterId)
  } catch (e) {
    console.warn('design sheet seed on lead conversion skipped:', e)
  }

  // The engagement being signed is what starts the SLA clock, and this is the
  // path the e-sign webhook takes. Idempotent, so a re-fired webhook or a
  // manual hire after the fact does not duplicate the checklist.
  //
  // `retemplate` is what makes the practice area resolved above stick: a lead
  // opened as an estate matter that converts as a College Preparation Plan is
  // carrying the estate checklist, and this is the moment to swap it — before
  // anyone has worked it, and while the CP checklist's own pre-engagement tasks
  // can still be dated off the discovery call the lead already had.
  await ensureMatterSlaTasks(matterId, { practiceArea, retemplate: true })

  // Day 0. A lead already carries its checklist, so the tasks above are a no-op
  // and the 28-day plan is still undated — replaying the engagement anchor is
  // what actually starts the firm clock. The signature date itself is stamped
  // on the matter inside convert_lead_to_matter, keeping conversion one write.
  try {
    const signedAt = intake.engagement_signed_at ?? new Date().toISOString()
    const dayZero = firmDateKey(signedAt)
    if (dayZero) {
      const anchored = await applySlaAnchor(admin, matterId, 'engagement', dayZero)
      if (!anchored.ok) console.warn('[sla-tasks] day-zero anchor skipped', matterId, anchored.error)
    }
  } catch (e) {
    console.warn('[sla-tasks] day-zero anchor failed for matter', matterId, e)
  }

  try {
    if (conversion.created) await admin.from('matter_activity').insert({
      matter_id: matterId,
      event_type: 'matter_created',
      title: 'Matter created from lead',
      detail: `${clientName} (${intake.email ?? 'no email'})`,
      actor_id: options.actorId ?? null,
    })
  } catch (e) {
    console.warn('matter_activity skipped:', e)
  }

  return { ok: true, matterId, matterNumber: resolvedMatterNumber }
}
