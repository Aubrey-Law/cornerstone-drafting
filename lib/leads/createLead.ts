import { getAdminClient } from '@/lib/supabaseAdmin'
import {
  createStandingIntakeVersion,
  standingIntakeUrl,
} from '@/lib/intake/standingLinks'
import { parsePracticeArea, type PracticeAreaCode } from '@/lib/practiceArea'
import { ensureLeadSlaTasks } from '@/lib/slaTasks/generate'

export interface CreateLeadInput {
  clientName: string
  clientEmail: string
  clientPhone?: string | null
  practiceArea?: string | null
  feeQuoted?: number | null
  clientUserId?: string | null
}

export interface CreatedLead {
  leadId: string
  clientName: string
  clientEmail: string
  practiceArea: PracticeAreaCode
  intakeUrl: string
}

export async function createLead(input: CreateLeadInput): Promise<CreatedLead> {
  const clientName = input.clientName.trim()
  const clientEmail = input.clientEmail.trim().toLowerCase()
  if (!clientName || !clientEmail) throw new Error('clientName and clientEmail are required')

  const practiceArea = parsePracticeArea(input.practiceArea ?? 'EP')
  if (!practiceArea) throw new Error('Invalid practice area')

  const feeQuoted =
    typeof input.feeQuoted === 'number' && Number.isFinite(input.feeQuoted)
      ? input.feeQuoted
      : null
  const nameParts = clientName.split(/\s+/)
  const admin = getAdminClient()
  const intakeLinkVersion = createStandingIntakeVersion()
  const intakeLinkCreatedAt = new Date().toISOString()
  const { data: lead, error } = await admin
    .from('client_intake')
    .insert({
      email: clientEmail,
      first_name: nameParts[0] ?? clientName,
      last_name: nameParts.slice(1).join(' ') || null,
      full_name: clientName,
      phone: input.clientPhone?.trim() || null,
      practice_area: practiceArea,
      status: 'in_progress',
      lead_status: 'lead',
      engagement_fee_quoted: feeQuoted,
      client_user_id: input.clientUserId ?? null,
      user_id: input.clientUserId ?? null,
      intake_link_version: intakeLinkVersion,
      intake_link_created_at: intakeLinkCreatedAt,
      intake_link_revoked_at: null,
    })
    .select('id')
    .single()

  if (error || !lead) throw new Error(error?.message ?? 'Failed to create lead')

  // `ensure_lead_matter` creates the opportunity in an AFTER trigger, so the
  // insert's RETURNING clause cannot carry it — read it back before seeding the
  // checklist. Best-effort: a lead must never fail to be created because its
  // SLA plan could not be written.
  const { data: opportunity } = await admin
    .from('matters')
    .select('id')
    .eq('client_intake_id', lead.id)
    .maybeSingle()
  if (opportunity?.id) await ensureLeadSlaTasks(opportunity.id, { practiceArea })

  return {
    leadId: lead.id,
    clientName,
    clientEmail,
    practiceArea,
    intakeUrl: standingIntakeUrl(lead.id, intakeLinkVersion),
  }
}
