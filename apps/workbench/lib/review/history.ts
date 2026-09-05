import type { SupabaseClient } from '@supabase/supabase-js'
import type { Citation, TextLayer } from '@aubrey-law/citations/textLayer/types'
import type { FindingOutcome, ReviewRule } from '@aubrey-law/citations/review/types'
import type { VerifyReason } from '@aubrey-law/citations/textLayer/match'
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

/** Numeric where possible, so rule 10 sorts after rule 2 rather than before it. */
function ruleOrder(ruleNumber: string): [number, string] {
  const leading = Number.parseInt(ruleNumber, 10)
  return [Number.isNaN(leading) ? Number.MAX_SAFE_INTEGER : leading, ruleNumber]
}

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

function toLayer(row: Row | null): TextLayer | null {
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
 */
export function toStoredRun(
  runRow: Row,
  findingRows: readonly Row[],
  citationRows: readonly Row[],
  layerRow: Row | null,
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
    matterId: String(runRow.matter_id),
    documentVersionId: String(runRow.document_version_id),
    playbookSlug: String(runRow.playbook_slug ?? ''),
    playbookVersion: Number(runRow.playbook_version ?? 0),
    status: String(runRow.status ?? ''),
    ruleTotal: Number(runRow.rule_total ?? 0),
    failedCount: Number(runRow.failed_count ?? 0),
    failures: (runRow.failures as StoredRun['failures']) ?? [],
    finishedAt: str(runRow.finished_at),
    findings,
    layer: toLayer(layerRow),
  }
}

function untyped(client: SupabaseClient<never>): SupabaseClient {
  return client as unknown as SupabaseClient
}

export interface RunSummary {
  runId: string
  matterTitle: string
  documentName: string
  status: string
  ruleTotal: number
  findingCount: number
  failedCount: number
  finishedAt: string | null
}

/** Recent runs, newest first — a review is returned to soon after it is made. */
export async function loadRunSummaries(
  client: SupabaseClient<never>,
  limit = 25,
): Promise<RunSummary[]> {
  const sb = untyped(client)
  const { data: runs, error } = await sb
    .from('workflow_runs')
    .select('id, matter_id, document_version_id, status, rule_total, finding_count, failed_count, finished_at')
    .order('started_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`Could not load runs: ${error.message}`)
  if (!runs || runs.length === 0) return []

  const [{ data: matters }, { data: versions }] = await Promise.all([
    sb.from('matters').select('id, title').in('id', [...new Set(runs.map((r) => String(r.matter_id)))]),
    sb
      .from('document_versions')
      .select('id, document_id, filename')
      .in('id', [...new Set(runs.map((r) => String(r.document_version_id)))]),
  ])

  const documentIds = [...new Set((versions ?? []).map((v) => String(v.document_id)))]
  const { data: documents } = documentIds.length
    ? await sb.from('matter_documents').select('id, name').in('id', documentIds)
    : { data: [] }

  const titleById = new Map((matters ?? []).map((m) => [String(m.id), String(m.title ?? 'Untitled matter')]))
  const nameByDocument = new Map((documents ?? []).map((d) => [String(d.id), String(d.name)]))
  const nameByVersion = new Map(
    (versions ?? []).map((v) => [
      String(v.id),
      nameByDocument.get(String(v.document_id)) ?? str(v.filename) ?? 'Document',
    ]),
  )

  return runs.map((run) => ({
    runId: String(run.id),
    matterTitle: titleById.get(String(run.matter_id)) ?? 'Untitled matter',
    documentName: nameByVersion.get(String(run.document_version_id)) ?? 'Document',
    status: String(run.status ?? ''),
    ruleTotal: Number(run.rule_total ?? 0),
    findingCount: Number(run.finding_count ?? 0),
    failedCount: Number(run.failed_count ?? 0),
    finishedAt: str(run.finished_at),
  }))
}

export async function loadRun(
  client: SupabaseClient<never>,
  runId: string,
): Promise<StoredRun | null> {
  const sb = untyped(client)
  const { data: runs, error } = await sb.from('workflow_runs').select('*').eq('id', runId).limit(1)
  if (error) throw new Error(`Could not load the run: ${error.message}`)
  const runRow = runs?.[0]
  if (!runRow) return null

  const [{ data: findings }, { data: layers }] = await Promise.all([
    sb.from('workflow_findings').select('*').eq('run_id', runId),
    runRow.text_layer_id
      ? sb.from('document_text_layers').select('*').eq('id', runRow.text_layer_id).limit(1)
      : Promise.resolve({ data: [] as Row[] }),
  ])

  const findingIds = (findings ?? []).map((f) => String(f.id))
  const { data: citations } = findingIds.length
    ? await sb.from('workflow_citations').select('*').in('finding_id', findingIds)
    : { data: [] as Row[] }

  return toStoredRun(runRow, findings ?? [], citations ?? [], layers?.[0] ?? null)
}
