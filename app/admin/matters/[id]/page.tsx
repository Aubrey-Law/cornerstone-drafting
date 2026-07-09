import { notFound } from 'next/navigation'
import { fetchMatter, fetchMatterContacts } from '@/lib/queries/matterCore'
import { fetchMatterAgingHealth } from '@/lib/queries/matterOverview'
import { isTwilioSmsConfigured } from '@/lib/twilio/config'
import { isMicrosoftConfigured } from '@/lib/microsoftCalendar'
import { getAdminClient } from '@/lib/supabaseAdmin'
import MatterDetailClient from './MatterDetailClient'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export default async function MatterDetailPage({ params }: Params) {
  const { id } = await params
  const [matter, contacts, agingHealth] = await Promise.all([
    fetchMatter(id),
    fetchMatterContacts(id),
    fetchMatterAgingHealth(id),
  ])

  if (!matter) notFound()

  const admin = getAdminClient()
  const { data: matterRow } = await admin
    .from('matters')
    .select('client_intake_id')
    .eq('id', id)
    .maybeSingle()

  const intakeId = (matterRow?.client_intake_id ?? null) as string | null
  let clientIntakeRow: {
    id: string
    intake_sent_at: string | null
    intake_completed_at: string | null
    email: string | null
    first_name: string | null
    status?: string | null
    user_id?: string | null
    client_user_id?: string | null
    unlock_requested_at?: string | null
    unlock_request_note?: string | null
  } | null = null

  if (intakeId) {
    const { data } = await admin
      .from('client_intake')
      .select('id, intake_sent_at, intake_completed_at, email, first_name, status, user_id, client_user_id, unlock_requested_at, unlock_request_note')
      .eq('id', intakeId)
      .maybeSingle()
    clientIntakeRow = data
  }

  return (
    <MatterDetailClient
      matter={matter}
      matterId={id}
      contacts={contacts}
      agingHealth={agingHealth}
      intakeId={intakeId}
      clientIntakeRow={clientIntakeRow}
      twilioSmsEnabled={isTwilioSmsConfigured()}
      emailSendEnabled={isMicrosoftConfigured() || Boolean(process.env.RESEND_API_KEY)}
    />
  )
}
