import { fetchMatterAging } from '@/lib/queries/pipelineAging'
import MatterAgingClient from './MatterAgingClient'

export const dynamic = 'force-dynamic'

export default async function MatterAgingPage() {
  const aging = await fetchMatterAging()
  return <MatterAgingClient initialRows={aging.rows} initialTiles={aging.tiles} />
}
