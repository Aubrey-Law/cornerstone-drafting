import type { SupabaseClient } from '@supabase/supabase-js'
import type { GeneratedDatabase } from '@/types/supabase'

/**
 * Reading saved issue-spotting and proofreading passes back, for review
 * history. See `lib/addinScan/record.ts` for how they are written.
 *
 * One query per table rather than an embedded select: the column checks in
 * `scripts/lib/queryReferences.mjs` read each table's columns from its own
 * select, and cannot read them through an embed.
 */

type Client = SupabaseClient<GeneratedDatabase>

export type ScanKind = 'issues' | 'proofread'
export type Importance = 'important' | 'notable' | 'minor'

export const SCAN_LABEL: Record<ScanKind, string> = { issues: 'Issue spotting', proofread: 'Proofread' }

export interface ScanSummary {
  scanId: string
  kind: ScanKind
  status: string
  itemCount: number
  sectionTotal: number | null
  sectionCompleted: number
  failures: Array<{ section: number; reason: string }>
  reviewUploadId: string
  documentName: string
  matterId: string | null
  startedAt: string
  finishedAt: string | null
}

export interface StoredScanItem {
  id: string
  category: string
  importance: Importance
  title: string
  explanation: string
  replacement: string | null
  citation: { blockIndex: number; charStart: number; charEnd: number; quote: string } | null
  citationRefusal: string | null
  attemptedQuote: string | null
}

export interface StoredScan extends ScanSummary {
  items: StoredScanItem[]
}

const IMPORTANCE_ORDER: Record<Importance, number> = { important: 0, notable: 1, minor: 2 }
const SCAN_COLUMNS =
  'id, kind, status, item_count, section_total, section_completed, failures, review_upload_id, started_at, finished_at'

type ScanRow = {
  id: string
  kind: string
  status: string
  item_count: number
  section_total: number | null
  section_completed: number
  failures: unknown
  review_upload_id: string
  started_at: string
  finished_at: string | null
}

function failuresOf(value: unknown): ScanSummary['failures'] {
  if (!Array.isArray(value)) return []
  return value.flatMap(entry => {
    const f = (entry ?? {}) as { section?: unknown; reason?: unknown }
    return typeof f.section === 'number' ? [{ section: f.section, reason: String(f.reason ?? '') }] : []
  })
}

async function summaries(client: Client, rows: ScanRow[]): Promise<ScanSummary[]> {
  const uploadIds = [...new Set(rows.map(row => row.review_upload_id))]
  const uploads = new Map<string, { label: string; matterId: string | null }>()
  if (uploadIds.length > 0) {
    const { data, error } = await client.from('review_uploads').select('id, label, matter_id').in('id', uploadIds)
    if (error) throw new Error(`Could not load the checked documents: ${error.message}`)
    for (const upload of data ?? []) {
      uploads.set(String(upload.id), { label: String(upload.label), matterId: upload.matter_id ?? null })
    }
  }
  return rows.map(row => ({
    scanId: row.id,
    kind: row.kind === 'proofread' ? 'proofread' : 'issues',
    status: row.status,
    itemCount: row.item_count,
    sectionTotal: row.section_total,
    sectionCompleted: row.section_completed,
    failures: failuresOf(row.failures),
    reviewUploadId: row.review_upload_id,
    documentName: uploads.get(row.review_upload_id)?.label ?? 'Word document',
    matterId: uploads.get(row.review_upload_id)?.matterId ?? null,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  }))
}

/** Newest first; optionally only those run against one saved copy of a document. */
export async function loadScanSummaries(
  client: Client,
  options: { limit?: number; reviewUploadId?: string } = {},
): Promise<ScanSummary[]> {
  let query = client.from('document_scans').select(SCAN_COLUMNS).order('started_at', { ascending: false }).limit(options.limit ?? 100)
  if (options.reviewUploadId) query = query.eq('review_upload_id', options.reviewUploadId)
  const { data, error } = await query
  if (error) throw new Error(`Could not load saved checks: ${error.message}`)
  return summaries(client, (data ?? []) as ScanRow[])
}

export async function loadScan(client: Client, scanId: string): Promise<StoredScan | null> {
  const { data: row, error } = await client.from('document_scans').select(SCAN_COLUMNS).eq('id', scanId).maybeSingle()
  if (error) throw new Error(`Could not load the check: ${error.message}`)
  if (!row) return null
  const [summary] = await summaries(client, [row as ScanRow])

  const { data: items, error: itemsError } = await client
    .from('document_scan_items')
    .select('id, sequence, category, importance, title, explanation, replacement, block_index, char_start, char_end, quote, citation_refusal, attempted_quote')
    .eq('scan_id', scanId)
    .order('sequence', { ascending: true })
  if (itemsError) throw new Error(`Could not load the check's items: ${itemsError.message}`)

  const stored: StoredScanItem[] = (items ?? []).map(item => ({
    id: String(item.id),
    category: item.category,
    importance: (['important', 'notable', 'minor'].includes(item.importance) ? item.importance : 'notable') as Importance,
    title: item.title,
    explanation: item.explanation,
    replacement: item.replacement,
    citation:
      item.quote !== null && item.block_index !== null && item.char_start !== null && item.char_end !== null
        ? { blockIndex: item.block_index, charStart: item.char_start, charEnd: item.char_end, quote: item.quote }
        : null,
    citationRefusal: item.citation_refusal,
    attemptedQuote: item.attempted_quote,
  }))

  return {
    ...summary,
    // Most important first; within a level, the order the check reported them.
    items: stored
      .map((item, index) => ({ item, index }))
      .sort((a, b) => IMPORTANCE_ORDER[a.item.importance] - IMPORTANCE_ORDER[b.item.importance] || a.index - b.index)
      .map(({ item }) => item),
  }
}

/** The saved playbook review that kept this copy of the document, when one did. */
export async function loadReviewRunIdForUpload(client: Client, reviewUploadId: string): Promise<string | null> {
  const { data, error } = await client
    .from('workflow_runs')
    .select('id')
    .eq('kind', 'review')
    .eq('review_upload_id', reviewUploadId)
    .order('started_at', { ascending: false })
    .limit(1)
  if (error) throw new Error(`Could not load the review this ran with: ${error.message}`)
  return data?.[0] ? String(data[0].id) : null
}

/** A saved check's state in one phrase, never "clean" for one that did not finish. */
export function scanStatusLabel(scan: ScanSummary, now: Date = new Date()): string {
  switch (scan.status) {
    case 'completed':
      return 'complete'
    case 'partial':
      return 'some sections not checked'
    case 'failed':
      return 'did not run'
    case 'stopped':
      return 'stopped part-way'
    default:
      // A scan runs in one request, capped at five minutes; one still running
      // well past that belonged to a request that died.
      if (scan.finishedAt) return scan.status
      return now.getTime() - new Date(scan.startedAt).getTime() < 10 * 60_000 ? 'in progress' : 'did not finish'
  }
}
