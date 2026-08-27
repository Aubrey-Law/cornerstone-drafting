import { fetchMattersList } from '@/lib/queries/matters'
import MattersClient from '../../MattersClient'

export const dynamic = 'force-dynamic'

export default async function MattersPage() {
  const { matters, error } = await fetchMattersList()
  return <MattersClient matters={matters} loadError={error} />
}
