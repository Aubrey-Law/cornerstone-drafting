import { notFound } from 'next/navigation'
import { fetchMatter, fetchMatterContacts } from '@/lib/queries/matterCore'
import { isTwilioSmsConfigured } from '@/lib/twilio/config'
import { isMicrosoftConfigured } from '@/lib/microsoftCalendar'
import MatterDetailClient from './MatterDetailClient'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export default async function MatterDetailPage({ params }: Params) {
  const { id } = await params
  const [matter, contacts] = await Promise.all([
    fetchMatter(id),
    fetchMatterContacts(id),
  ])

  if (!matter) notFound()

  return (
    <MatterDetailClient
      matter={matter}
      contacts={contacts}
      twilioSmsEnabled={isTwilioSmsConfigured()}
      emailSendEnabled={isMicrosoftConfigured() || Boolean(process.env.RESEND_API_KEY)}
    />
  )
}
