import { getAdminClient } from '@/lib/supabaseAdmin'
import { parsePracticeArea, type PracticeAreaCode } from '@/lib/practiceArea'

export interface CreateLeadInput {
  clientName: string
  clientEmail: string
  clientPhone?: string | null
  practiceArea?: string | null
  feeQuoted?: number | null
}

export interface CreatedLead {
  leadId: string
  clientName: string
  clientEmail: string
  practiceArea: PracticeAreaCode
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
    })
    .select('id')
    .single()

  if (error || !lead) throw new Error(error?.message ?? 'Failed to create lead')

  return {
    leadId: lead.id,
    clientName,
    clientEmail,
    practiceArea,
  }
}
