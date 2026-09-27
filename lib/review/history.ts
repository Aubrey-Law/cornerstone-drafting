import type { SupabaseClient } from '@supabase/supabase-js'
import type { GeneratedDatabase } from '@/types/supabase'
import type { Citation, TextLayer } from '@aubrey-law/citations/textLayer/types'
import type { FindingOutcome, ReviewRule } from '@aubrey-law/citations/review/types'
import type { VerifyReason } from '@aubrey-law/citations/textLayer/match'
import { ruleOrder } from '@/lib/runs/history'
import { toRunSteps } from '@/lib/runs/steps'
import type { Disposition, StoredFinding, StoredRun } from './persist'

/**
 * Reading a recorded review back.
 *
 * The stored text layer is what makes this possible: every citation is a pair
 * of offsets into that layer's text, so the layer travels with the run and a
 * past review highlights exactly what it highlighted on the day. Without it a
 * citation is two numbers, and the view must say it cannot highlight rather
 * than highlight the wrong thing.
 */

type Row = Record<string, unknown>

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null

function toCitation(row: Row): Citation {
  return {
    blockIndex: Number(row.block_index ?? 0),
    charStart: Number(row.char_start ?? 0),
    charEnd: Number(row.char_end ?? 0),
    page: row.page === null || row.page === undefined ? null : Number(row.page),
    bbox: (row.bbox as Citation['bbox']) ?? null,
    quote: String(row.quote ?? ''),
    verification: (str(row.verification) as Citation['verification']) ?? 'unverified',
  }
}

/**
 * Exported for `lib/runs/retry.ts`: a review's pinned evidence is its
 * `text_layer_id`, and retrying it means reading the same row back through
 * this same conversion — never re-extracting from R2, and never duplicating
 * the row shape this function already knows.
 */
export function toLayer(row: Row | null): TextLayer | null {
  if (!row) return null
  return {
    sourceKind: (str(row.source_kind) as TextLayer['sourceKind']) ?? 'plain',
    status: row.status === 'no_text' ? 'no_text' : 'ok',
    extractor: String(row.extractor ?? ''),
    extractorVersion: String(row.extractor_version ?? ''),
    sourceSha256: String(row.source_sha256 ?? ''),
    pageCount: row.page_count === null || row.page_count === undefined ? null : Number(row.page_count),
    text: String(row.text ?? ''),
    blocks: (row.blocks as TextLayer['blocks']) ?? [],
    spans: (row.spans as TextLayer['spans']) ?? [],
  }
}

/**
 * Rebuilds a run from its rows.
 *
 * Pure, so the joining is asserted directly. The one mistake worth guarding is
 * attaching a citation to the wrong finding: a claim about a client's
 * instrument pointing at words another rule found would be worse than no
 * citation at all, and it would look entirely convincing.
 *
 * `promptVersionRow` and `promptRow` are optional and travel separately from
 * `runRow` rather than through an embedded select, the same way the matter
 * and document lookups below do: `scripts/lib/queryReferences.mjs` cannot
 * split an embedded select's columns per table, so `query-columns.test.ts`
 * would flag one. They are null whenever the run's `prompt_version_id` no
 * longer resolves to a real version — an edited-out version cannot be shown,
 * only reported as missing rather than invented.
 *
 * `stepRows` is optional and converted through `lib/runs/steps.ts`'s
 * `toRunSteps` — the same ordering-by-sequence logic the field-audit view
 * uses, rather than a second copy of it living here.
 */
export function toStoredRun(
  runRow: Row,
  findingRows: readonly Row[],
  citationRows: readonly Row[],
  layerRow: Row | null,
  promptVersionRow: Row | null = null,
  promptRow: Row | null = null,
  stepRows: readonly Row[] = [],
  uploadRow: Row | null = null,
): StoredRun {
  const citationByFinding = new Map<string, Row>()
  for (const row of citationRows) {
    const findingId = str(row.finding_id)
    if (findingId) citationByFinding.set(findingId, row)
  }

  const findings: StoredFinding[] = findingRows
    .map((row) => {
      const findingId = String(row.id)
      const citationRow = citationByFinding.get(findingId) ?? null
      return {
        findingId,
        ruleNumber: String(row.rule_number ?? ''),
        outcome: (str(row.outcome) as FindingOutcome) ?? 'not_applicable',
        severity: (str(row.severity) as ReviewRule['risk'] | null) ?? null,
        rationale: String(row.rationale ?? ''),
        proposedLanguage: str(row.proposed_language),
        citation: citationRow ? toCitation(citationRow) : null,
        citationRefusal: (str(row.citation_refusal) as VerifyReason | null) ?? null,
        attemptedQuote: str(row.attempted_quote),
        disposition: (str(row.disposition) as Disposition) ?? 'open',
        dispositionNote: str(row.disposition_note),
      }
    })
    .sort((a, b) => {
      const [aNum, aRaw] = ruleOrder(a.ruleNumber)
      const [bNum, bRaw] = ruleOrder(b.ruleNumber)
      return aNum - bNum || aRaw.localeCompare(bRaw)
    })

  return {
    runId: String(runRow.id),
    // Null for a review of an unfiled upload — never `String(null)`, which
    // would read as a matter whose id is the word "null".
    matterId: runRow.matter_id === null || runRow.matter_id === undefined ? null : String(runRow.matter_id),
    reviewUploadId: str(runRow.review_upload_id),
    documentLabel: uploadRow ? (str(uploadRow.label) ?? str(uploadRow.filename)) : null,
    // A review is run against a filed document or an upload, but `document_version_id`
    // is nullable on the column, and a run recorded before it existed — or of
    // a different kind entirely — genuinely has none. `String(null)` would
    // silently produce the literal string "null" here; this run has no
    // document rather than a document named that.
    documentVersionId:
      runRow.document_version_id === null || runRow.document_version_id === undefined
        ? null
        : String(runRow.document_version_id),
    kind: String(runRow.kind ?? 'review'),
    promptVersionId: runRow.prompt_version_id ? String(runRow.prompt_version_id) : null,
    promptSlug: promptRow ? str(promptRow.slug) : null,
    promptVersionNumber: promptVersionRow ? Number(promptVersionRow.version_number) : null,
    status: String(runRow.status ?? ''),
    ruleTotal: Number(runRow.rule_total ?? 0),
    failedCount: Number(runRow.failed_count ?? 0),
    failures: (runRow.failures as StoredRun['failures']) ?? [],
    finishedAt: str(runRow.finished_at),
    findings,
    layer: toLayer(layerRow),
    steps: toRunSteps(stepRows),
  }
}

/** What a run's matter column reads as when the review is of an unfiled upload. */
export const UNFILED_UPLOAD_TITLE = 'Not filed on a matter'

export interface RunSummary {
  runId: string
  matterTitle: string
  /** True when the review is of an unfiled upload rather than a filed document. */
  unfiled?: boolean
  documentName: string
  status: string
  ruleTotal: number
  findingCount: number
  failedCount: number
  finishedAt: string | null
}

/**
 * Recent review runs, newest first — a review is returned to soon after it is
 * made.
 *
 * Scoped to `kind = 'review'`: `workflow_runs` now also holds field-audit
 * runs, which have no document at all. Joining one of those to a document
 * name the way this always has would produce a summary row for a run this
 * page has no way to open (a review run's page assumes a document and a text
 * layer) — a field audit gets its own list, on `/admin/field-audits`.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * With `matterId`, only that matter's reviews: runs of its filed documents,
 * and runs of every upload linked to it (a prior plan, or a Word snapshot),
 * whose own `matter_id` is null by design (20261228090000).
 */
export async function loadRunSummaries(
  client: SupabaseClient<GeneratedDatabase>,
  limit = 25,
  options: { matterId?: string } = {},
): Promise<RunSummary[]> {
  const sb = client
  let query = sb
    .from('workflow_runs')
    .select('id, matter_id, document_version_id, review_upload_id, status, rule_total, finding_count, failed_count, finished_at')
    .eq('kind', 'review')
  if (options.matterId !== undefined) {
    // Interpolated into a PostgREST filter below, so it must be exactly a uuid.
    if (!UUID.test(options.matterId)) return []
    const { data: linked, error: linkedError } = await sb
      .from('review_uploads')
      .select('id')
      .eq('matter_id', options.matterId)
    if (linkedError) throw new Error(`Could not load the matter's uploads: ${linkedError.message}`)
    const uploadIds = (linked ?? []).map((u) => String(u.id)).filter((id) => UUID.test(id))
    query = uploadIds.length
      ? query.or(`matter_id.eq.${options.matterId},review_upload_id.in.(${uploadIds.join(',')})`)
      : query.eq('matter_id', options.matterId)
  }
  const { data: runs, error } = await query.order('started_at', { ascending: false }).limit(limit)
  if (error) throw new Error(`Could not load runs: ${error.message}`)
  if (!runs || runs.length === 0) return []

  // Only the ids a run actually has: an upload's review has no matter and no
  // version, and `String(null)` would put the word "null" into an `in` list.
  const idsOf = (column: 'matter_id' | 'document_version_id' | 'review_upload_id') => [
    ...new Set(runs.map((r) => r[column]).filter((id): id is string => typeof id === 'string' && id.length > 0)),
  ]
  const matterIds = idsOf('matter_id')
  const versionIds = idsOf('document_version_id')
  const uploadIds = idsOf('review_upload_id')
  const [{ data: matters }, { data: versions }, { data: uploads }] = await Promise.all([
    matterIds.length ? sb.from('matters').select('id, name').in('id', matterIds) : Promise.resolve({ data: [] as Row[] }),
    versionIds.length
      ? sb.from('document_versions').select('id, document_id, filename').in('id', versionIds)
      : Promise.resolve({ data: [] as Row[] }),
    uploadIds.length
      ? sb.from('review_uploads').select('id, label, filename, matter_id, origin').in('id', uploadIds)
      : Promise.resolve({ data: [] as Row[] }),
  ])

  // Matters that uploads were later linked to, when not already loaded.
  const linkedMatterIds = [
    ...new Set(
      (uploads ?? [])
        .map((u) => u.matter_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0 && !matterIds.includes(id)),
    ),
  ]
  const { data: linkedMatters } = linkedMatterIds.length
    ? await sb.from('matters').select('id, name').in('id', linkedMatterIds)
    : { data: [] as Row[] }

  const documentIds = [...new Set((versions ?? []).map((v) => String(v.document_id)))]
  const { data: documents } = documentIds.length
    ? await sb.from('matter_documents').select('id, name').in('id', documentIds)
    : { data: [] }

  const titleById = new Map(
    [...(matters ?? []), ...(linkedMatters ?? [])].map((m) => [String(m.id), String(m.name ?? 'Untitled matter')]),
  )
  const nameByDocument = new Map((documents ?? []).map((d) => [String(d.id), String(d.name)]))
  const nameByVersion = new Map(
    (versions ?? []).map((v) => [
      String(v.id),
      nameByDocument.get(String(v.document_id)) ?? str(v.filename) ?? 'Document',
    ]),
  )

  const labelByUpload = new Map(
    (uploads ?? []).map((u) => [String(u.id), str(u.label) ?? str(u.filename) ?? 'Upload']),
  )
  const linkedMatterByUpload = new Map((uploads ?? []).map((u) => [String(u.id), str(u.matter_id)]))
  const fromWord = new Set((uploads ?? []).filter((u) => u.origin === 'word').map((u) => String(u.id)))

  return runs.map((run) => ({
    runId: String(run.id),
    ...(run.review_upload_id
      ? {
          // An upload's own reviews carry no matter; the matter it was linked
          // to later is read from the upload (20261228090000).
          matterTitle: (() => {
            const uploadId = String(run.review_upload_id)
            const linked = linkedMatterByUpload.get(uploadId)
            // A snapshot the Word add-in kept (20261230090000) says so: it is
            // the firm's draft as it stood in Word, not a document uploaded.
            const kind = fromWord.has(uploadId) ? 'from Word' : 'upload'
            if (linked) return `${titleById.get(linked) ?? 'Untitled matter'} · ${kind}`
            return fromWord.has(uploadId) ? `${UNFILED_UPLOAD_TITLE} · from Word` : UNFILED_UPLOAD_TITLE
          })(),
          unfiled: true,
          documentName: labelByUpload.get(String(run.review_upload_id)) ?? 'Upload',
        }
      : {
          matterTitle: titleById.get(String(run.matter_id)) ?? 'Untitled matter',
          documentName: nameByVersion.get(String(run.document_version_id)) ?? 'Document',
        }),
    status: String(run.status ?? ''),
    ruleTotal: Number(run.rule_total ?? 0),
    findingCount: Number(run.finding_count ?? 0),
    failedCount: Number(run.failed_count ?? 0),
    finishedAt: str(run.finished_at),
  }))
}

export async function loadRun(
  client: SupabaseClient<GeneratedDatabase>,
  runId: string,
): Promise<StoredRun | null> {
  const sb = client
  const { data: runs, error } = await sb.from('workflow_runs').select('*').eq('id', runId).limit(1)
  if (error) throw new Error(`Could not load the run: ${error.message}`)
  const runRow = runs?.[0]
  if (!runRow) return null

  const [{ data: findings }, { data: layers }, { data: stepRows }] = await Promise.all([
    sb.from('workflow_findings').select('*').eq('run_id', runId),
    runRow.text_layer_id
      ? sb.from('document_text_layers').select('*').eq('id', runRow.text_layer_id).limit(1)
      : Promise.resolve({ data: [] as Row[] }),
    sb.from('workflow_run_steps').select('*').eq('run_id', runId),
  ])

  let uploadRow: Row | null = null
  if (runRow.review_upload_id) {
    const { data: uploads } = await sb
      .from('review_uploads')
      .select('id, label, filename, matter_id, filed_document_id, origin')
      .eq('id', String(runRow.review_upload_id))
      .limit(1)
    uploadRow = uploads?.[0] ?? null
  }
  let uploadMatterTitle: string | null = null
  if (uploadRow?.matter_id) {
    const { data: linked } = await sb.from('matters').select('id, name').eq('id', String(uploadRow.matter_id)).limit(1)
    uploadMatterTitle = linked?.[0] ? (str(linked[0].name) ?? 'Untitled matter') : null
  }

  const findingIds = (findings ?? []).map((f) => String(f.id))
  const { data: citations } = findingIds.length
    ? await sb.from('workflow_citations').select('*').in('finding_id', findingIds)
    : { data: [] as Row[] }

  // Two more plain lookups rather than one embedded select, for the same
  // reason the matter/document lookups above are separate: only a
  // `.select('col1, col2')` string can be checked column-by-column against
  // the generated types.
  let promptVersionRow: Row | null = null
  let promptRow: Row | null = null
  if (runRow.prompt_version_id) {
    const { data: versions } = await sb
      .from('prompt_versions')
      .select('id, prompt_id, version_number')
      .eq('id', String(runRow.prompt_version_id))
      .limit(1)
    promptVersionRow = versions?.[0] ?? null
    if (promptVersionRow?.prompt_id) {
      const { data: prompts } = await sb
        .from('prompts')
        .select('id, slug')
        .eq('id', String(promptVersionRow.prompt_id))
        .limit(1)
      promptRow = prompts?.[0] ?? null
    }
  }

  return {
    ...toStoredRun(
      runRow,
      findings ?? [],
      citations ?? [],
      layers?.[0] ?? null,
      promptVersionRow,
      promptRow,
      stepRows ?? [],
      uploadRow,
    ),
    uploadMatterId: uploadRow ? str(uploadRow.matter_id) : null,
    uploadMatterTitle,
    uploadFiled: Boolean(uploadRow?.filed_document_id),
    uploadFromWord: uploadRow?.origin === 'word',
  }
}
