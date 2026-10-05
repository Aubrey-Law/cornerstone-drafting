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
    const editableDocument = await loadEngagementDocumentState(getAdminClient(), agreement.document_id)
    return <EngagementWorkspace agreement={agreement} editableDocument={editableDocument} />
  } catch (error) {
    console.error('Could not load engagement workspace', { agreementId, error })
    notFound()
  }
}
