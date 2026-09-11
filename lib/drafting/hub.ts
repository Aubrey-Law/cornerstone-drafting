import type { DraftingHubMatter } from '@/lib/queries/drafting'
import type { HubActionFilter } from './hubUtils'

export interface DraftingHubPage {
  matters: DraftingHubMatter[]
  total: number
  page: number
  pageSize: number
  /** Search + practice area; the action filter does not hide sibling counts. */
  actionCounts: Record<HubActionFilter, number>
  /** Search + action; each practice area shows its own matching total. */
  practiceCounts: Array<{ name: string; count: number }>
  error: string | null
}
export const EMPTY_HUB_COUNTS: DraftingHubPage['actionCounts'] = {
  all: 0, design: 0, setup: 0, generate: 0, review: 0, revise: 0, quiet: 0,
}
