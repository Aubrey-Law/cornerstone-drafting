import { redirect } from 'next/navigation'

/**
 * A matter's funding lives on the matter now, as the Funding view of its
 * Assets tab. Old links and bookmarks land there.
 */
export default async function MatterFundingRedirect({ params }: { params: Promise<{ matterId: string }> }) {
  const { matterId } = await params
  redirect(`/admin/matters/${encodeURIComponent(matterId)}?tab=assets&view=funding`)
}
