import type { SupabaseClient } from '@supabase/supabase-js'
import type { GeneratedDatabase } from '@/types/supabase'
import { nameIssueFor, type IdentityIssue } from './matrix'
import {
  IDENTITY_TASK_SOURCE,
  identityTaskRowFor,
  planIdentityEmit,
  type ExistingIdentityTask,
} from './tasks'

const MATTER_SELECT = 'id, name'
const SHEET_SELECT = 'matter_id, version, client_name, spouse_name'

/**
 * No `skipped`, unlike `FiduciarySweepResult`, and the asymmetry is deliberate.
 *
 * The fiduciary sweep skips a matter it *chose* not to judge and counts that.
 * Here there is nothing to choose: a matter without a sheet, or a sheet without
 * a client name, is not a candidate at all and never reaches the loop. What is
 * left is a query failing, and this sweep does not continue past one — it
 * throws, because it withdraws tasks when nothing is desired, so carrying on
 * after a failed read risks retiring a task on the strength of a query that
 * did not answer. There is no state in between worth counting.
 */
export interface IdentitySweepResult {
  mattersConsidered: number
  created: number
  kept: number
  superseded: number
}

interface Candidate {
  matter: { id: string; name: string | null }
  sheet: { clientName: string | null; spouseName: string | null }
}

/**
 * Every hired matter that has a design sheet, with the sheet's names.
 *
 * Throws on a query error rather than returning what it managed to read. An
 * empty list from a failed query looks exactly like "every name agrees", and
 * this sweep withdraws tasks when nothing is desired — so absorbing the error
 * would retire every identity task in the practice on one bad query. That is
 * the same conflation that once let an uncitable finding retire a cited one.
 *
 * `hired` only. A name disagreement on a lead is not yet drafting anything.
 */
export async function loadNameCandidates(
  client: SupabaseClient<GeneratedDatabase>,
): Promise<Candidate[]> {
  const sb = client

  const { data: matters, error: matterError } = await sb
    .from('matters')
    .select(MATTER_SELECT)
    .eq('relationship_status', 'hired')
  if (matterError) {
    throw new Error(`Could not load matters for the name check: ${matterError.message}`)
  }

  const { data: sheets, error: sheetError } = await sb.from('design_sheets').select(SHEET_SELECT)
  if (sheetError) {
    throw new Error(`Could not load the design sheets for the name check: ${sheetError.message}`)
  }

  // The highest version on file is the current sheet — the ordering
  // `loadSourceRows` and `loadGateContext` already use.
  const latestByMatter = new Map<string, Record<string, unknown>>()
  for (const row of (sheets ?? []) as Array<Record<string, unknown>>) {
    const matterId = String(row.matter_id)
    const current = latestByMatter.get(matterId)
    const version = Number(row.version ?? 0)
    if (!current || version >= Number(current.version ?? 0)) latestByMatter.set(matterId, row)
  }

  const candidates: Candidate[] = []
  for (const matter of (matters ?? []) as Array<Record<string, unknown>>) {
    const sheet = latestByMatter.get(String(matter.id))
    if (!sheet) continue
    candidates.push({
      matter: { id: String(matter.id), name: (matter.name as string | null) ?? null },
      sheet: {
        clientName: (sheet.client_name as string | null) ?? null,
        spouseName: (sheet.spouse_name as string | null) ?? null,
      },
    })
  }
  return candidates
}

/**
 * Makes every hired matter's identity task say what its records say.
 *
 * Unqueued and run on every tick, the same trade `sweepFiduciaryTasks`
 * documents: the machinery to schedule and claim one sweep would cost more than
 * the sweep does, and it is a handful of string comparisons over a few dozen
 * rows.
 */
export async function sweepNameAgreement(
  client: SupabaseClient<GeneratedDatabase>,
): Promise<IdentitySweepResult> {
  const sb = client
  const candidates = await loadNameCandidates(sb)

  const result: IdentitySweepResult = {
    mattersConsidered: candidates.length,
    created: 0,
    kept: 0,
    superseded: 0,
  }

  for (const candidate of candidates) {
    const issue: IdentityIssue | null = nameIssueFor(candidate.matter, candidate.sheet)
    const desired = issue ? [identityTaskRowFor(issue)] : []

    const { data: taskRows, error: taskError } = await sb
      .from('tasks')
      .select('id, source, batch_tag, status, assignee_id, title, priority, closeout_reason')
      .eq('matter_id', candidate.matter.id)
      .eq('source', IDENTITY_TASK_SOURCE)
    if (taskError) {
      throw new Error(
        `Could not load identity tasks for ${candidate.matter.id}: ${taskError.message}`,
      )
    }

    const existing: ExistingIdentityTask[] = (
      (taskRows ?? []) as Array<Record<string, unknown>>
    ).map((row) => ({
      id: String(row.id),
      source: String(row.source),
      batchTag: (row.batch_tag as string | null) ?? null,
      status: String(row.status),
      assigneeId: (row.assignee_id as string | null) ?? null,
      title: String(row.title ?? ''),
      priority: String(row.priority ?? ''),
      closeoutReason: (row.closeout_reason as string | null) ?? null,
    }))

    const plan = planIdentityEmit(candidate.matter.id, existing, desired)

    if (plan.insert.length > 0) {
      const { error } = await sb.from('tasks').insert(plan.insert)
      if (error) {
        throw new Error(
          `Could not create the identity task for ${candidate.matter.id}: ${error.message}`,
        )
      }
    }
    if (plan.supersede.length > 0) {
      const { error } = await sb
        .from('tasks')
        .update({
          status: 'archived',
          skipped_at: new Date().toISOString(),
          closeout_reason: 'identity_resolved',
        })
        .in('id', plan.supersede)
      if (error) {
        throw new Error(
          `Could not withdraw identity tasks for ${candidate.matter.id}: ${error.message}`,
        )
      }
    }

    result.created += plan.insert.length
    result.kept += plan.keep.length
    result.superseded += plan.supersede.length
  }

  return result
}
