import { notFound } from 'next/navigation'
import EngagementWorkspace from '@/components/engagement/EngagementWorkspace'
import { getScopedAgreement, requireEngagementStaff } from '@/lib/engagement/http'

export const dynamic = 'force-dynamic'
export default async function Page({ params }: { params: Promise<{ agreementId: string }> }) {
  const { agreementId } = await params
  try { await requireEngagementStaff(); const agreement = await getScopedAgreement(agreementId); return <EngagementWorkspace agreement={agreement} /> } catch (error) { console.error('Could not load engagement workspace', { agreementId, error }); notFound() }
}
