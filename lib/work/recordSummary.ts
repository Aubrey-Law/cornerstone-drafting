import { compareWorkItems } from '@/lib/work/ranking'
import type {
  PriorityBand,
  PriorityReason,
  WorkItem,
  WorkOwner,
  WorkState,
} from '@/lib/work/types'

export interface RecordWorkSummary {
  recordType: 'lead' | 'matter'
  recordId: string
  workKey: string
  sourceType: WorkItem['sourceType']
  title: string
  actionLabel: string
  href: string
  owner: WorkOwner
  state: WorkState
  priorityBand: PriorityBand
  priorityReasons: PriorityReason[]
  dueAt: string | null
  estimateMinutes: number
  /** Every canonical obligation currently attached to this record. */
  itemCount: number
  /** Firm-owned, executable Critical/Must do/Soon obligations. */
  attentionCount: number
}

/**
 * "Needs action" is intentionally narrower than "has work". Planned work and
 * anything owed by a client or automation remain visible on the record, but do
 * not pull that record into the attorney's attention queue.
 */
export function isRecordAttentionItem(item: WorkItem): boolean {
  return item.owner === 'firm' && item.state === 'open' && item.priorityBand <= 2
}

function summarize(items: WorkItem[]): RecordWorkSummary | null {
  const record = items[0]?.record
  if (!record?.id || record.type === 'firm') return null

  const ordered = [...items].sort(compareWorkItems)
  const attention = ordered.filter(isRecordAttentionItem)
  // An executable obligation is the useful primary action even when the same
  // record also has client-owned or snoozed evidence. If there is none, retain
  // the first waiting/blocked item so the list can say who owns the next move.
  const primary = attention[0]
    ?? ordered.find(item => item.owner === 'firm' && item.state === 'open')
    ?? ordered[0]
  if (!primary) return null

  return {
    recordType: record.type,
    recordId: record.id,
    workKey: primary.workKey,
    sourceType: primary.sourceType,
    title: primary.title,
    actionLabel: primary.actionLabel,
    href: primary.href,
    owner: primary.owner,
    state: primary.state,
    priorityBand: primary.priorityBand,
    priorityReasons: primary.priorityReasons.slice(0, 2),
    dueAt: primary.dueAt ?? null,
    estimateMinutes: primary.estimateMinutes,
    itemCount: ordered.length,
    attentionCount: attention.length,
  }
}

/**
 * Collapse the already-ranked canonical graph to one serializable summary per
 * lead or matter. The stable record id is the key passed across the RSC/client
 * boundary; no database row or message body is copied into a second model.
 */
export function buildRecordWorkSummaries(
  items: WorkItem[],
  recordType?: 'lead' | 'matter',
): Record<string, RecordWorkSummary> {
  const grouped = new Map<string, WorkItem[]>()
  // Do not assume every caller received the graph directly. Sorting here
  // preserves canonical ranking in object insertion order for filtered
  // record queues and exports as well as for the UI.
  for (const item of [...items].sort(compareWorkItems)) {
    if (!item.record.id || item.record.type === 'firm') continue
    if (recordType && item.record.type !== recordType) continue
    const key = `${item.record.type}:${item.record.id}`
    const existing = grouped.get(key)
    if (existing) existing.push(item)
    else grouped.set(key, [item])
  }

  const summaries: Record<string, RecordWorkSummary> = {}
  for (const group of grouped.values()) {
    const summary = summarize(group)
    if (summary) summaries[summary.recordId] = summary
  }
  return summaries
}

export function attentionRecordIds(
  summaries: Record<string, RecordWorkSummary>,
): string[] {
  return Object.values(summaries)
    .filter(summary => summary.attentionCount > 0)
    .map(summary => summary.recordId)
}
