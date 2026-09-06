import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from '@/lib/supabase/database'
import type { FieldAuditCheck } from '@aubrey-law/citations/prompt/body'
import type { FieldAuditFinding } from '@aubrey-law/citations/fieldAudit/types'

/**
 * The `tasks.source` value a field-audit run's own tasks carry.
 *
 * `tasks_source_check` was extended to allow this (see the migration
 * alongside this file, 20261029000000_prompt_task_source.sql): none of
 * manual/stage/template/cadence/sla means "a prompt run created this", and
 * `tasksToSupersede` below depends on that being a fact the database
 * enforces on every row, not a convention this module merely assumes every
 * caller respects.
 */
export const PROMPT_TASK_SOURCE = 'prompt'

export interface TaskRow {
  matter_id: string
  source: string
  task_type: string
  auto: boolean
  batch_tag: string
  title: string
  description: string
  priority: string
}

/**
 * One `tasks` row per actionable finding, templated from the check that
 * produced it.
 *
 * `findings` is expected to already be `actionableFindings(result)` from
 * `@aubrey-law/citations/fieldAudit/runFieldAudit` — only findings whose
 * references all verified — so nothing here re-checks that; this is purely
 * the templating step, matching a finding back to the check it came from and
 * filling in its template.
 */
export function taskRowsFor(
  matterId: string,
  runId: string,
  checks: FieldAuditCheck[],
  findings: FieldAuditFinding[],
): TaskRow[] {
  const checkByNumber = new Map(checks.map((check) => [check.number, check]))

  return findings.flatMap((finding) => {
    const check = checkByNumber.get(finding.checkNumber)
    // A finding whose check number names nothing in this prompt version has
    // no template to fill in — the prompt and the result have fallen out of
    // step with each other — so it is skipped rather than guessed at.
    if (!check) return []

    return [
      {
        matter_id: matterId,
        source: PROMPT_TASK_SOURCE,
        task_type: 'single',
        auto: true,
        // Names both the run and the unit: a task records which run
        // produced it *and* which check within that run, so a retry can
        // later replace one unit's task without touching the rest of the
        // run's tasks. See `tasksToSupersedeForUnits` below.
        batch_tag: `prompt:${runId}#${finding.checkNumber}`,
        title: check.taskTemplate.title,
        // The template's own description first, then the specific rationale
        // this finding gave — the template says what kind of problem this
        // is, the rationale says what the sheet actually shows.
        description: `${check.taskTemplate.description}\n\n${finding.rationale}`,
        priority: check.taskTemplate.priority,
      },
    ]
  })
}

export interface ExistingPromptTask {
  id: string
  source: string
  batchTag: string | null
  status: string
  assigneeId: string | null
}

/**
 * Pulls the run id (and, if present, the unit id) out of a `batch_tag`.
 *
 * A tag is `prompt:${runId}` (no unit — nothing but a first run ever wrote
 * that shape before this module started stamping units) or
 * `prompt:${runId}#${unitId}`. Parsing the run id back out, rather than
 * comparing the whole tag string, is what lets `tasksToSupersede` keep
 * meaning "this run" even once the tag carries a unit suffix it knows
 * nothing about. Returns `null` for a tag that doesn't fit either shape —
 * such a tag is not this run's own by construction, so callers should treat
 * that the same as "some other run".
 */
function parseBatchTag(tag: string | null): { runId: string; unitId: string | null } | null {
  if (!tag) return null
  const match = /^prompt:([^#]+)(?:#(.+))?$/.exec(tag)
  if (!match) return null
  return { runId: match[1], unitId: match[2] ?? null }
}

/**
 * Which of a matter's earlier prompt-sourced tasks a new *first* run should
 * close.
 *
 * Narrow on purpose, on every axis at once:
 *
 *  - `source === PROMPT_TASK_SOURCE` only. A tool may withdraw its own
 *    suggestion; it must never touch a task a person added by hand, or one
 *    the stage engine or the SLA plan is tracking. Those did not come from a
 *    prompt run and are not this run's to close.
 *  - `status === 'open'` only. A task already `done` is a record of work
 *    that actually happened, not a live suggestion still standing — closing
 *    it out because a newer run no longer finds the issue would rewrite what
 *    happened rather than tidy a queue. A `blocked` or `in_progress` task is
 *    left alone for a related reason: something is already underway on it.
 *  - `assigneeId === null` only. The moment someone picks it up, a
 *    tool-suggested task becomes real work someone is doing. A newer run no
 *    longer surfacing the same finding does not make that work moot, and
 *    closing it out from under the person doing it would erase something
 *    real to tidy something cosmetic.
 *  - the tag's run id is not this run's own. A run cannot supersede itself;
 *    this is what stops the tasks a run just created from being read back as
 *    "earlier" and immediately withdrawn in the same breath. Compared by the
 *    run id parsed out of the tag, not the whole tag string, so this still
 *    holds now that a tag can carry a unit suffix this function does not
 *    otherwise care about — a first run supersedes a *previous run's* whole
 *    open, unassigned set, one unit at a time or not.
 */
export function tasksToSupersede(existing: ExistingPromptTask[], runId: string): string[] {
  return existing
    .filter((task) => task.source === PROMPT_TASK_SOURCE)
    .filter((task) => task.status === 'open')
    .filter((task) => task.assigneeId === null)
    .filter((task) => parseBatchTag(task.batchTag)?.runId !== runId)
    .map((task) => task.id)
}

/**
 * Which of *this run's own* tasks a retry of some of its units should close.
 *
 * A different question from `tasksToSupersede`, deliberately kept separate
 * rather than folded into it with a flag: a first run is withdrawing a
 * *previous run's* whole open set because this run is about to answer the
 * same questions again from scratch. A retry is replacing its own earlier
 * answer to one unit — the units that did not fail were never touched, so
 * their tasks (this run's own, tagged with units outside `unitIds`) must
 * survive untouched too. Matching on `runId` here, where `tasksToSupersede`
 * deliberately excludes it, is not a contradiction: it is the same
 * "supersede the tasks this exact question was already answered by"
 * property, aimed at the run that is retrying itself instead of the run
 * before it.
 *
 * The same open/unassigned narrowing applies, for the same reason: a tool
 * may withdraw its own suggestion, never a person's work in progress.
 */
export function tasksToSupersedeForUnits(
  existing: ExistingPromptTask[],
  runId: string,
  unitIds: string[],
): string[] {
  const units = new Set(unitIds)
  return existing
    .filter((task) => task.source === PROMPT_TASK_SOURCE)
    .filter((task) => task.status === 'open')
    .filter((task) => task.assigneeId === null)
    .filter((task) => {
      const parsed = parseBatchTag(task.batchTag)
      return parsed !== null && parsed.runId === runId && parsed.unitId !== null && units.has(parsed.unitId)
    })
    .map((task) => task.id)
}

export interface EmitTasksInput {
  matterId: string
  runId: string
  checks: FieldAuditCheck[]
  findings: FieldAuditFinding[]
  /**
   * Present only for a retry: the unit ids that were actually retried. When
   * given, `emitTasks` emits tasks for (and supersedes only) those units'
   * findings, using `tasksToSupersedeForUnits` instead of `tasksToSupersede`
   * — a retry replaces its own earlier answer to these units, not a
   * previous run's whole set. Absent, `emitTasks` behaves exactly as a first
   * run always has.
   */
  unitIds?: string[]
}

export interface EmitTasksResult {
  created: number
  superseded: number
}

/**
 * Creates this run's tasks, then withdraws the earlier prompt-sourced tasks
 * it supersedes.
 *
 * The matter's earlier prompt tasks are read *before* this run's own rows are
 * inserted below — not after, the way a first run reading only its own
 * `PROMPT_TASK_SOURCE` tag could get away with once. A retry's new task for a
 * unit carries the *same* `batch_tag` its earlier attempt's task did — same
 * run, same unit, see `taskRowsFor` — so a query taken after the insert would
 * see both rows under an identical tag with no way to tell "the one this call
 * just created" from "the one it means to withdraw". Reading first means the
 * snapshot `tasksToSupersede`/`tasksToSupersedeForUnits` judge is always
 * exactly what existed before this call, never what it just wrote.
 *
 * The archive itself still only happens after the insert succeeds: if the
 * insert fails, this function has already thrown before it ever reaches the
 * update below, so nothing that was still open a moment ago is closed out for
 * a run that never actually produced its replacements. Reading the snapshot
 * early changes only when the harmless part (a `select`) happens, not that
 * guarantee.
 */
export async function emitTasks(
  client: SupabaseClient<WorkbenchDatabase>,
  input: EmitTasksInput,
): Promise<EmitTasksResult> {
  const sb = client

  // Every earlier prompt task on this matter, regardless of status or who
  // holds it — `tasksToSupersede`/`tasksToSupersedeForUnits` are the only
  // places that decide which of them this call is actually allowed to close.
  const { data: existingRows, error: existingError } = await sb
    .from('tasks')
    .select('id, source, batch_tag, status, assignee_id')
    .eq('matter_id', input.matterId)
    .eq('source', PROMPT_TASK_SOURCE)
  if (existingError) {
    throw new Error(`Could not load this matter's earlier prompt tasks: ${existingError.message}`)
  }

  const existing: ExistingPromptTask[] = (existingRows ?? []).map((row) => ({
    id: String(row.id),
    source: String(row.source),
    batchTag: (row.batch_tag as string | null) ?? null,
    status: String(row.status),
    assigneeId: (row.assignee_id as string | null) ?? null,
  }))

  // A retry only ever knows about the units it actually retried — the
  // findings for units it did not touch belong to that unit's own earlier
  // task, which this call must leave alone.
  const findings = input.unitIds
    ? input.findings.filter((finding) => input.unitIds!.includes(finding.checkNumber))
    : input.findings

  const rows = taskRowsFor(input.matterId, input.runId, input.checks, findings)
  let created = 0
  if (rows.length > 0) {
    const { error: insertError } = await sb.from('tasks').insert(rows)
    if (insertError) throw new Error(`Could not create tasks for this run: ${insertError.message}`)
    created = rows.length
  }

  const superseded = input.unitIds
    ? tasksToSupersedeForUnits(existing, input.runId, input.unitIds)
    : tasksToSupersede(existing, input.runId)

  if (superseded.length > 0) {
    const { error: updateError } = await sb
      .from('tasks')
      .update({
        // Not a distinct 'skipped' status — see the header comment in
        // 20261029000000_prompt_task_source.sql for why this reuses the
        // archived + skipped_at pair `lib/tasks/types.ts`'s `isTaskSkipped`
        // already defines as "skipped" everywhere else in this codebase.
        status: 'archived',
        skipped_at: new Date().toISOString(),
        closeout_reason: 'prompt_superseded',
      })
      .in('id', superseded)
    if (updateError) throw new Error(`Could not withdraw superseded tasks: ${updateError.message}`)
  }

  return { created, superseded: superseded.length }
}
