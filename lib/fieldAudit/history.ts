import type { SupabaseClient } from '@supabase/supabase-js'
import type { GeneratedDatabase } from '@/types/supabase'
import type { FieldAuditOutcome, FieldVerification } from '@aubrey-law/citations/fieldAudit/types'
import { ruleOrder } from '@/lib/runs/history'
import type { Disposition } from '@/lib/review/persist'

/**
 * Reading a recorded field audit back.
 *
 * A field audit's evidence is its references — `workflow_field_references`,
 * one row per fact a check's finding rests on, carrying `matched_path` so a
 * structured field's provenance (`children[0].dob`) is not lost once the run
 * leaves memory. That is the field-audit analogue of a review's citation, and
 * this module is the field-audit analogue of `lib/review/history.ts`: the
 * kind-specific half of reading a run back, over `lib/runs/history.ts`'s
 * `loadAnyRun` for everything the two kinds share.
 */

type Row = Record<string, unknown>

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null

export interface StoredFieldReference {
  fieldKey: string
  claimedValue: string | null
  actualValue: string | null
  matchedPath: string | null
  verification: FieldVerification
}

export interface StoredFieldAuditFinding {
  findingId: string
  checkNumber: string
  outcome: FieldAuditOutcome
  severity: 'blocker' | 'high' | 'medium' | 'low' | null
  rationale: string
  disposition: Disposition
  dispositionNote: string | null
  references: StoredFieldReference[]
}

/**
 * Rebuilds a field audit's findings from its rows. Pure, for the same reason
 * `lib/review/history.ts`'s `toStoredRun` is: the one mistake worth guarding
 * against is attaching one finding's references to another.
 */
export function toStoredFieldAuditFindings(
  findingRows: readonly Row[],
  referenceRows: readonly Row[],
): StoredFieldAuditFinding[] {
  const referencesByFinding = new Map<string, Row[]>()
  for (const row of referenceRows) {
    const findingId = str(row.finding_id)
    if (!findingId) continue
    const existing = referencesByFinding.get(findingId)
    if (existing) existing.push(row)
    else referencesByFinding.set(findingId, [row])
  }

  return findingRows
    .map((row) => {
      const findingId = String(row.id)
      return {
        findingId,
        checkNumber: String(row.rule_number ?? ''),
        outcome: (str(row.outcome) as FieldAuditOutcome) ?? 'not_applicable',
        severity: (str(row.severity) as StoredFieldAuditFinding['severity']) ?? null,
        rationale: String(row.rationale ?? ''),
        disposition: (str(row.disposition) as Disposition) ?? 'open',
        dispositionNote: str(row.disposition_note),
        references: (referencesByFinding.get(findingId) ?? []).map((reference) => ({
          fieldKey: String(reference.field_key ?? ''),
          claimedValue: str(reference.claimed_value),
          actualValue: str(reference.actual_value),
          matchedPath: str(reference.matched_path),
          verification: (str(reference.verification) as FieldVerification) ?? 'unverified',
        })),
      }
    })
    .sort((a, b) => {
      const [aNum, aRaw] = ruleOrder(a.checkNumber)
      const [bNum, bRaw] = ruleOrder(b.checkNumber)
      return aNum - bNum || aRaw.localeCompare(bRaw)
    })
}

export async function loadFieldAuditFindings(
  client: SupabaseClient<GeneratedDatabase>,
  runId: string,
): Promise<StoredFieldAuditFinding[]> {
  const { data: findings, error } = await client.from('workflow_findings').select('*').eq('run_id', runId)
  if (error) throw new Error(`Could not load findings: ${error.message}`)

  const findingIds = (findings ?? []).map((f) => String(f.id))
  const { data: references } = findingIds.length
    ? await client.from('workflow_field_references').select('*').in('finding_id', findingIds)
    : { data: [] as Row[] }

  return toStoredFieldAuditFindings(findings ?? [], references ?? [])
}

export interface FieldAuditRunSummary {
  runId: string
  matterTitle: string
  promptTitle: string | null
  status: string
  findingCount: number
  failedCount: number
  finishedAt: string | null
}

/**
 * Recent field-audit runs, newest first — the list `/admin/field-audits` shows so a run
 * recorded there has somewhere to be seen. The review analogue of this,
 * `loadRunSummaries` in `lib/review/history.ts`, joins to a document; a field
 * audit has none, so this joins to the matter and the prompt it ran instead.
 */
export async function loadFieldAuditRunSummaries(
  client: SupabaseClient<GeneratedDatabase>,
  limit = 25,
): Promise<FieldAuditRunSummary[]> {
  const { data: runs, error } = await client
    .from('workflow_runs')
    .select('id, matter_id, prompt_version_id, status, finding_count, failed_count, finished_at')
    .eq('kind', 'field_audit')
    .order('started_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`Could not load runs: ${error.message}`)
  if (!runs || runs.length === 0) return []

  const matterIds = [...new Set(runs.map((r) => String(r.matter_id)))]
  const promptVersionIds = [...new Set(runs.filter((r) => r.prompt_version_id).map((r) => String(r.prompt_version_id)))]

  const [{ data: matters }, { data: promptVersions }] = await Promise.all([
    client.from('matters').select('id, name').in('id', matterIds),
    promptVersionIds.length
      ? client.from('prompt_versions').select('id, prompt_id').in('id', promptVersionIds)
      : Promise.resolve({ data: [] as Row[] }),
  ])

  const promptIds = [...new Set((promptVersions ?? []).map((v) => String(v.prompt_id)).filter(Boolean))]
  const { data: prompts } = promptIds.length
    ? await client.from('prompts').select('id, title').in('id', promptIds)
    : { data: [] as Row[] }

  const titleByPrompt = new Map((prompts ?? []).map((p) => [String(p.id), String(p.title)]))
  const promptTitleByVersion = new Map(
    (promptVersions ?? []).map((v) => [String(v.id), titleByPrompt.get(String(v.prompt_id)) ?? null]),
  )
  const titleByMatter = new Map((matters ?? []).map((m) => [String(m.id), str(m.name) ?? 'Untitled matter']))

  return runs.map((run) => ({
    runId: String(run.id),
    matterTitle: titleByMatter.get(String(run.matter_id)) ?? 'Untitled matter',
    promptTitle: run.prompt_version_id ? promptTitleByVersion.get(String(run.prompt_version_id)) ?? null : null,
    status: String(run.status ?? ''),
    findingCount: Number(run.finding_count ?? 0),
    failedCount: Number(run.failed_count ?? 0),
    finishedAt: str(run.finished_at),
  }))
}
