import { notFound } from 'next/navigation'
import EngagementWorkspace from '@/components/engagement/EngagementWorkspace'
import { loadEngagementDocumentState } from '@/lib/engagement/editableDocument'
import { getScopedAgreement, requireEngagementStaff } from '@/lib/engagement/http'
import { getAdminClient } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'
export default async function Page({ params }: { params: Promise<{ agreementId: string }> }) {
  const { agreementId } = await params
  try {
    await requireEngagementStaff()
    const agreement = await getScopedAgreement(agreementId)
    const admin = getAdminClient()
    const editableDocument = await loadEngagementDocumentState(admin, agreement.document_id)
    // What the matter records, which is also where a send outside the app is marked.
    const { data: details } = agreement.matter_id
      ? await admin.from('matter_details').select('engagement_status, engagement_sent_at, engagement_signed').eq('client_id', agreement.matter_id).maybeSingle()
      : { data: null }
    const recordedEngagement = {
      sentAt: (details?.engagement_sent_at as string | null | undefined) ?? null,
      signed: Boolean(details?.engagement_signed) || details?.engagement_status === 'signed',
    }
    return <EngagementWorkspace agreement={agreement} editableDocument={editableDocument} recordedEngagement={recordedEngagement} />
  } catch (error) {
    console.error('Could not load engagement workspace', { agreementId, error })
    notFound()
  }
}
