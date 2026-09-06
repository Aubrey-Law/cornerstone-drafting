import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from '@/lib/supabase/database'
import { toRunSteps } from './steps'
import type { RunStep } from './steps'

/**
 * Reading a run back, for either kind.
 *
 * `lib/review/history.ts` grew around a review, which always has a document:
 * `toStoredRun` there does `documentVersionId: String(runRow.document_version_id)`,
 * which is safe for a review but yields the literal string `"null"` for a
 * field audit, whose `document_version_id` genuinely is null — a run with no
 * document at all, not a document that happens to be missing.
 *
 * This is the kind-agnostic shape underneath both: a matter, a document only
 * when the run actually has one, the run's steps in the order they ran, and
 * the prompt version it was checked against. `lib/review/history.ts` keeps
 * its own `toStoredRun`/`loadRun` for what only a review needs — citations
 * and the text layer they index — and reads its steps and prompt label
 * through here rather than duplicating the ordering or the lookup.
 */

type Row = Record<string, unknown>

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null

/** Numeric where possible, so check/rule 10 sorts after 2 rather than before it. */
export function ruleOrder(ruleNumber: string): [number, string] {
  const leading = Number.parseInt(ruleNumber, 10)
  return [Number.isNaN(leading) ? Number.MAX_SAFE_INTEGER : leading, ruleNumber]
}

export interface AnyRunDocument {
  documentVersionId: string
  documentName: string
}

export interface AnyRun {
  runId: string
  matterId: string
  matterTitle: string
  kind: string
  status: string
  ruleTotal: number
  failedCount: number
  failures: Array<{ ruleNumber: string; reason: string }>
  finishedAt: string | null
  promptVersionId: string | null
  promptSlug: string | null
  promptVersionNumber: number | null
  /** Null for a field audit, which runs against a matter's declared facts, not a document. */
  document: AnyRunDocument | null
  steps: RunStep[]
}

/**
 * Rebuilds a run's kind-agnostic shape from its rows. Pure, so the one thing
 * worth asserting directly — a field audit reporting no document rather than
 * a document named `"null"` — is asserted without a database.
 */
export function toAnyRun(
  runRow: Row,
  stepRows: readonly Row[],
  matterRow: Row | null,
  documentVersionRow: Row | null,
  documentRow: Row | null,
  promptVersionRow: Row | null = null,
  promptRow: Row | null = null,
): AnyRun {
  const rawDocumentVersionId = runRow.document_version_id
  const documentVersionId =
    rawDocumentVersionId === null || rawDocumentVersionId === undefined ? null : String(rawDocumentVersionId)

  const document: AnyRunDocument | null = documentVersionId
    ? {
        documentVersionId,
        documentName:
          (documentRow ? str(documentRow.name) : null) ??
          (documentVersionRow ? str(documentVersionRow.filename) : null) ??
          'Document',
      }
    : null

  return {
    runId: String(runRow.id),
    matterId: String(runRow.matter_id),
    matterTitle: matterRow ? (str(matterRow.name) ?? 'Untitled matter') : 'Untitled matter',
    kind: String(runRow.kind ?? 'review'),
    status: String(runRow.status ?? ''),
    ruleTotal: Number(runRow.rule_total ?? 0),
    failedCount: Number(runRow.failed_count ?? 0),
    failures: (runRow.failures as AnyRun['failures']) ?? [],
    finishedAt: str(runRow.finished_at),
    promptVersionId: runRow.prompt_version_id ? String(runRow.prompt_version_id) : null,
    promptSlug: promptRow ? str(promptRow.slug) : null,
    promptVersionNumber: promptVersionRow ? Number(promptVersionRow.version_number) : null,
    document,
    steps: toRunSteps(stepRows),
  }
}

/**
 * Loads one run, kind-aware. Used directly by the field-audit run view
 * (`app/prompts/[runId]/page.tsx`); the review view keeps its own `loadRun`
 * for the citations and text layer only a review needs, but reads its steps
 * and prompt label through the same conversions this module exports.
 */
export async function loadAnyRun(client: SupabaseClient<WorkbenchDatabase>, runId: string): Promise<AnyRun | null> {
  const { data: runs, error } = await client.from('workflow_runs').select('*').eq('id', runId).limit(1)
  if (error) throw new Error(`Could not load the run: ${error.message}`)
  const runRow = runs?.[0]
  if (!runRow) return null

  const { data: stepRows, error: stepsError } = await client
    .from('workflow_run_steps')
    .select('*')
    .eq('run_id', runId)
  if (stepsError) throw new Error(`Could not load the run's steps: ${stepsError.message}`)

  const { data: matters } = await client
    .from('matters')
    .select('id, name')
    .eq('id', String(runRow.matter_id))
    .limit(1)

  // Two more plain lookups rather than one embedded select, for the same
  // reason lib/review/history.ts's loadRun keeps its own separate: only a
  // `.select('col1, col2')` string can be checked column-by-column against
  // the generated types (scripts/lib/queryReferences.mjs).
  let documentVersionRow: Row | null = null
  let documentRow: Row | null = null
  if (runRow.document_version_id) {
    const { data: versions } = await client
      .from('document_versions')
      .select('id, document_id, filename')
      .eq('id', String(runRow.document_version_id))
      .limit(1)
    documentVersionRow = versions?.[0] ?? null
    if (documentVersionRow?.document_id) {
      const { data: documents } = await client
        .from('matter_documents')
        .select('id, name')
        .eq('id', String(documentVersionRow.document_id))
        .limit(1)
      documentRow = documents?.[0] ?? null
    }
  }

  let promptVersionRow: Row | null = null
  let promptRow: Row | null = null
  if (runRow.prompt_version_id) {
    const { data: versions } = await client
      .from('prompt_versions')
      .select('id, prompt_id, version_number')
      .eq('id', String(runRow.prompt_version_id))
      .limit(1)
    promptVersionRow = versions?.[0] ?? null
    if (promptVersionRow?.prompt_id) {
      const { data: prompts } = await client
        .from('prompts')
        .select('id, slug')
        .eq('id', String(promptVersionRow.prompt_id))
        .limit(1)
      promptRow = prompts?.[0] ?? null
    }
  }

  return toAnyRun(
    runRow,
    stepRows ?? [],
    matters?.[0] ?? null,
    documentVersionRow,
    documentRow,
    promptVersionRow,
    promptRow,
  )
}
