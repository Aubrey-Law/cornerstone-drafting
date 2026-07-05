import { fetchDraftingHubMatters } from '@/lib/queries/drafting'
import DraftingHubClient from './DraftingHubClient'

export const dynamic = 'force-dynamic'

export default async function DraftingPage() {
  const { matters, error } = await fetchDraftingHubMatters()
  return <DraftingHubClient matters={matters} loadError={error} />
}
