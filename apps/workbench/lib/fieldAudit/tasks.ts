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
        batch_tag: `prompt:${runId}`,
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
 * Which of a matter's earlier prompt-sourced tasks a new run should close.
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
 *  - `batchTag` not this run's own. A run cannot supersede itself; this is
 *    what stops the tasks a run just created from being read back as
 *    "earlier" and immediately withdrawn in the same breath.
 */
export function tasksToSupersede(existing: ExistingPromptTask[], runId: string): string[] {
  const thisRunsTag = `prompt:${runId}`
  return existing
    .filter((task) => task.source === PROMPT_TASK_SOURCE)
    .filter((task) => task.batchTag !== thisRunsTag)
    .filter((task) => task.status === 'open')
    .filter((task) => task.assigneeId === null)
    .map((task) => task.id)
}

export interface EmitTasksInput {
  matterId: string
  runId: string
  checks: FieldAuditCheck[]
  findings: FieldAuditFinding[]
}

export interface EmitTasksResult {
  created: number
  superseded: number
}

/**
 * Creates this run's tasks, then withdraws the earlier prompt-sourced tasks
 * it supersedes.
 *
 * Created before superseded, not the other way round: if the insert fails,
 * nothing that was still open a moment ago has been closed out for a run that
 * never actually produced its replacements.
 */
export async function emitTasks(
  client: SupabaseClient<WorkbenchDatabase>,
  input: EmitTasksInput,
): Promise<EmitTasksResult> {
  const sb = client

  const rows = taskRowsFor(input.matterId, input.runId, input.checks, input.findings)
  let created = 0
  if (rows.length > 0) {
    const { error: insertError } = await sb.from('tasks').insert(rows)
    if (insertError) throw new Error(`Could not create tasks for this run: ${insertError.message}`)
    created = rows.length
  }

  // Every earlier prompt task on this matter, regardless of status or who
  // holds it — `tasksToSupersede` is the single place that decides which of
  // them a new run is actually allowed to close.
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

  const superseded = tasksToSupersede(existing, input.runId)

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
