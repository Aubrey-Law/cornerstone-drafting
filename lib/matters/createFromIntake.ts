import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizePracticeArea, practiceAreaLabel } from '@/lib/practiceArea'
import { ensureDesignSheetSeededFromIntake } from '@/lib/designSheet/ensureDesignSheetSeeded'
import { generateUniqueMatterNumber } from '@/lib/matterNumber'

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
