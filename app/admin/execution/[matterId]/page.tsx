import { redirect } from 'next/navigation'

/**
 * A matter's signing checklist and record live on the matter now, as the
 * Signing view of its Documents tab. Old links and bookmarks land there.
 */
export default async function MatterExecutionRedirect({ params }: { params: Promise<{ matterId: string }> }) {
  const { matterId } = await params
  redirect(`/admin/matters/${encodeURIComponent(matterId)}?tab=documents&view=signing`)
}
