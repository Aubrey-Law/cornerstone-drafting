import type { DraftingHubMatter } from '@/lib/queries/drafting'

export type HubSortKey = 'updated' | 'client' | 'action'
export type HubNextActionKey = 'design' | 'setup' | 'generate' | 'review' | 'revise'
export type HubActionFilter = 'all' | HubNextActionKey | 'quiet'

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

export function hubNextActionKey(item: DraftingHubMatter): HubNextActionKey {
  const stage = item.matter.stage
  if (stage === 'revision') return 'revise'
  if (stage === 'client_review' || stage === 'drafts_approved') return 'review'
  if (!item.designSheet) return 'design'
  if (item.setupBlockers.length > 0 || item.includedDocumentLabels.length === 0) return 'setup'
  if (item.draftCount === 0) return 'generate'
  return 'review'
}

export function hubSortTimestamp(item: DraftingHubMatter): number {
  const draftAt = item.recentDrafts[0]?.created_at
  const designAt = item.designSheet?.updatedAt
  const matterAt = item.matter.matter_created
  const pick = draftAt ?? designAt ?? matterAt
  return pick ? Date.parse(pick) : 0
}

export function hubNextAction(item: DraftingHubMatter) {
  const key = hubNextActionKey(item)
  if (key === 'design') {
    return { key, label: 'Start design', detail: 'No design sheet yet', tone: 'warning' as const }
  }
  if (key === 'setup') {
    const detail = item.setupBlockers.length > 0
      ? `${item.setupBlockers.length} setup blocker${item.setupBlockers.length === 1 ? '' : 's'}`
      : 'Select documents'
    return { key, label: 'Complete setup', detail, tone: 'warning' as const }
  }
  if (key === 'generate') {
    return { key, label: 'Generate documents', detail: 'Design is ready', tone: 'success' as const }
  }
  if (key === 'revise') {
    return { key, label: 'Revise documents', detail: 'Client or attorney changes', tone: 'warning' as const }
  }
  return {
    key,
    label: 'Review & share',
    detail: `${item.draftCount} current draft${item.draftCount === 1 ? '' : 's'}`,
    tone: 'info' as const,
  }
}

export function sortHubMatters(list: DraftingHubMatter[], sortKey: HubSortKey): DraftingHubMatter[] {
  return [...list].sort((a, b) => {
    if (sortKey === 'client') {
      return (a.matter.client_name ?? '').localeCompare(b.matter.client_name ?? '', undefined, { sensitivity: 'base' })
    }
    if (sortKey === 'action') {
      const order: Record<HubNextActionKey, number> = {
        design: 0,
        setup: 1,
        generate: 2,
        review: 3,
        revise: 4,
      }
      return order[hubNextActionKey(a)] - order[hubNextActionKey(b)]
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
