/**
 * The Review tab's view of an issue-spotting or proofreading pass, as
 * `app/api/addin/scan/route.ts` streams it. A copy of the server's shapes, not
 * an import, for the same reason as ./model.
 *
 * Pure, like ./model: counting, filtering and "what may this item do" are
 * tested without Word or a server.
 */

import type { FindingCitation } from './model'

export type ScanKind = 'issues' | 'proofread'
export type Importance = 'important' | 'notable' | 'minor'

export interface ScanItem {
  id: string
  category: string
  importance: Importance
  title: string
  explanation: string
  replacement: string | null
  citation: FindingCitation | null
  citationRefusal: string | null
  attemptedQuote: string | null
}

export type ScanRecording =
  | { saved: true; scanId: string; reviewUploadId: string }
  | { saved: false; reason: string }

export type ScanEvent =
  | { start: true; kind: ScanKind; recording?: ScanRecording }
  | { items: ScanItem[] }
  | { failure: { section: number; reason: string } }
  | { done: true; sections: number; completed: number; aborted: boolean; recordingProblem?: string }
  | { error: string }

export interface ScanState {
  started: boolean
  /** Null before the scan starts, or from a server that predates saving. */
  recording: ScanRecording | null
  /** Set when saving started but a later write failed. */
  recordingProblem: string | null
  items: ScanItem[]
  failures: Array<{ section: number; reason: string }>
  sections: number | null
  done: boolean
  aborted: boolean
  error: string | null
}

export const EMPTY_SCAN: ScanState = {
  started: false,
  recording: null,
  recordingProblem: null,
  items: [],
  failures: [],
  sections: null,
  done: false,
  aborted: false,
  error: null,
}

export function applyScanEvent(state: ScanState, event: ScanEvent): ScanState {
  if ('start' in event) return { ...EMPTY_SCAN, started: true, recording: event.recording ?? null }
  if ('items' in event) return { ...state, items: [...state.items, ...event.items] }
  if ('failure' in event) return { ...state, failures: [...state.failures, event.failure] }
  if ('done' in event) {
    return { ...state, done: true, aborted: event.aborted, sections: event.sections, recordingProblem: event.recordingProblem ?? null }
  }
  return { ...state, error: event.error, done: true }
}

export const SCAN_LABEL: Record<ScanKind, string> = { issues: 'Issue spotting', proofread: 'Proofread' }

export const IMPORTANCE_LABEL: Record<Importance, string> = {
  important: 'Important',
  notable: 'Notable',
  minor: 'Minor',
}

export const IMPORTANCE_ORDER: Record<Importance, number> = { important: 0, notable: 1, minor: 2 }

export function tallyImportance(items: ScanItem[]): Record<Importance, number> {
  const counts: Record<Importance, number> = { important: 0, notable: 0, minor: 0 }
  for (const item of items) counts[item.importance] += 1
  return counts
}

/** The categories present, most frequent first — the filter offers only what is there. */
export function categoriesOf(items: ScanItem[]): string[] {
  const counts = new Map<string, number>()
  for (const item of items) counts.set(item.category, (counts.get(item.category) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([category]) => category)
}

export type ScanSort = 'importance' | 'document'

/** Items without a place in the document sort after those with one. */
const position = (item: ScanItem) => (item.citation ? item.citation.blockIndex : Number.MAX_SAFE_INTEGER)

export function filterItems(
  items: ScanItem[],
  options: { category: string | 'all'; importance: Importance | 'all'; query: string; sort: ScanSort },
): ScanItem[] {
  const query = options.query.trim().toLowerCase()
  const kept = items.filter(
    (item) =>
      (options.category === 'all' || item.category === options.category) &&
      (options.importance === 'all' || item.importance === options.importance) &&
      (!query || `${item.title} ${item.explanation} ${item.citation?.quote ?? ''}`.toLowerCase().includes(query)),
  )
  return [...kept].sort((a, b) =>
    options.sort === 'importance'
      ? IMPORTANCE_ORDER[a.importance] - IMPORTANCE_ORDER[b.importance] || position(a) - position(b)
      : position(a) - position(b) || IMPORTANCE_ORDER[a.importance] - IMPORTANCE_ORDER[b.importance],
  )
}

export interface ItemActions {
  reveal: boolean
  comment: boolean
  replace: string | null
}

/** As for a playbook finding: anything that marks up the document needs a verified citation. */
export function itemActions(item: ScanItem): ItemActions {
  const cited = item.citation !== null && item.citation.verification === 'verified'
  return { reveal: cited, comment: cited, replace: cited && item.replacement ? item.replacement : null }
}

/** Every replacement "Apply all" may make, most important first. */
export function scanReplacements(items: ScanItem[]): Array<{ item: ScanItem; text: string }> {
  return [...items]
    .sort((a, b) => IMPORTANCE_ORDER[a.importance] - IMPORTANCE_ORDER[b.importance])
    .flatMap((item) => {
      const replace = itemActions(item).replace
      return replace ? [{ item, text: replace }] : []
    })
}

export function scanCommentText(kind: ScanKind, item: ScanItem): string {
  const lines = [`Cornerstone ${SCAN_LABEL[kind].toLowerCase()} — ${item.category} (${IMPORTANCE_LABEL[item.importance].toLowerCase()})`, item.title]
  if (item.explanation) lines.push('', item.explanation)
  if (item.replacement) lines.push('', `Suggested: ${item.replacement}`)
  return lines.join('\n')
}
