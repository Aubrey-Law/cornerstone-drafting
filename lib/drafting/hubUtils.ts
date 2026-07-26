import type { DraftingHubMatter } from '@/lib/queries/drafting'

export type HubSortKey = 'updated' | 'client' | 'stage'
export type HubReadinessBucket = 'ready' | 'needs_design' | 'needs_setup'
export type HubReadinessFilter = 'all' | HubReadinessBucket | 'quiet'
export type DraftingHubView = 'kanban' | 'table'

export const DRAFTING_HUB_VIEW_KEY = 'drafting-hub-view'

/** Days without activity before a matter is flagged as quiet in the hub and the matter list. */
export const QUIET_DAYS = 10

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

export function hubReadinessBucket(item: DraftingHubMatter): HubReadinessBucket {
  if (!item.designSheet) return 'needs_design'
  if (item.includedDocumentLabels.length === 0) return 'needs_setup'
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

/** Whole days since the matter last moved, or null when there is no usable timestamp. */
export function hubDaysSinceActivity(item: DraftingHubMatter): number | null {
  const at = hubLastActivityAt(item)
  if (!at) return null
  const ms = Date.parse(at)
  if (!Number.isFinite(ms)) return null
  return Math.max(0, Math.floor((Date.now() - ms) / 86_400_000))
}

export function isHubQuiet(item: DraftingHubMatter): boolean {
  const days = hubDaysSinceActivity(item)
  return days !== null && days >= QUIET_DAYS
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
