import type { DraftingHubMatter } from '@/lib/queries/drafting'

export type HubSortKey = 'updated' | 'client' | 'stage'
export type HubReadinessFilter = 'all' | 'ready' | 'needs_design' | 'needs_setup'
export type DraftingHubView = 'kanban' | 'table'

export const DRAFTING_HUB_VIEW_KEY = 'drafting-hub-view'

function matterHaystack(item: DraftingHubMatter): string {
  const m = item.matter
  return [
    item.matterNumber,
    m.matter_id,
    m.client_name,
    m.spouse_name,
    m.matter_name,
    m.client_email,
    m.plan_type,
    m.practice_area,
    m.stage,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

export function matchesHubSearch(item: DraftingHubMatter, query: string): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return true
  const haystack = matterHaystack(item)
  return tokens.every(token => haystack.includes(token))
}

export function hubReadinessBucket(item: DraftingHubMatter): HubReadinessFilter {
  if (!item.designSheet) return 'needs_design'
  if (item.setupBlockers.length > 0 || item.includedDocumentLabels.length === 0) return 'needs_setup'
  return 'ready'
}

export function hubSortTimestamp(item: DraftingHubMatter): number {
  const draftAt = item.recentDrafts[0]?.created_at
  const designAt = item.designSheet?.updatedAt
  const matterAt = item.matter.matter_created
  const pick = draftAt ?? designAt ?? matterAt
  return pick ? Date.parse(pick) : 0
}

export function hubReadinessLabel(item: DraftingHubMatter) {
  const bucket = hubReadinessBucket(item)
  if (bucket === 'needs_design') return { label: 'Needs design', tone: 'warning' as const }
  if (bucket === 'needs_setup') return { label: 'Setup needed', tone: 'warning' as const }
  return { label: 'Ready', tone: 'success' as const }
}

export function sortHubMatters(list: DraftingHubMatter[], sortKey: HubSortKey): DraftingHubMatter[] {
  return [...list].sort((a, b) => {
    if (sortKey === 'client') {
      return (a.matter.client_name ?? '').localeCompare(b.matter.client_name ?? '', undefined, { sensitivity: 'base' })
    }
    if (sortKey === 'stage') {
      return (a.matter.stage ?? '').localeCompare(b.matter.stage ?? '')
    }
    return hubSortTimestamp(b) - hubSortTimestamp(a)
  })
}

export function hubLastActivityAt(item: DraftingHubMatter): string | null {
  const lastDraft = item.recentDrafts[0]
  return lastDraft?.created_at ?? item.designSheet?.updatedAt ?? item.matter.matter_created ?? null
}

export function readDraftingHubView(): DraftingHubView {
  if (typeof window === 'undefined') return 'kanban'
  const raw = window.localStorage.getItem(DRAFTING_HUB_VIEW_KEY)
  return raw === 'table' ? 'table' : 'kanban'
}

export function writeDraftingHubView(view: DraftingHubView) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(DRAFTING_HUB_VIEW_KEY, view)
}
