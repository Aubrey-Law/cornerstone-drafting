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
 * `planEmit` below depends on that being a fact the database enforces on
 * every row, not a convention this module merely assumes every caller
 * respects.
 */
export const PROMPT_TASK_SOURCE = 'prompt'

/**
 * A checklist item as `public.tasks.checklist` holds them. Declared here
 * rather than imported from the root app's `lib/tasks/types.ts`: this is a
 * separate app with its own module graph, and the shared contract is the
 * column, not a TypeScript file across an app boundary.
 */
export interface ChecklistItem {
  text: string
  done: boolean
}

export interface TaskRow {
  matter_id: string
  source: string
  task_type: string
  auto: boolean
  batch_tag: string
  title: string
  description: string
  priority: string
  /** Empty for a `single` task; one entry per finding for a `checklist` one. */
  checklist: ChecklistItem[]
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
        // run's tasks. See `planEmit` below.
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

/**
 * An existing prompt task, with everything `planEmit` compares.
 *
 * The content fields are here because identity is by content: a task that
 * already says exactly what this run wants to say is the same task, and
 * re-creating it would churn its id and its `created_at` for nothing.
 */
export interface ExistingPromptTask {
  id: string
  source: string
  batchTag: string | null
  status: string
  assigneeId: string | null
  title: string
  description: string
  priority: string
  taskType: string
  checklist: ChecklistItem[]
}

export interface EmitPlan {
  /** Rows to create. */
  insert: TaskRow[]
  /** Ids left exactly as they are, because they already say this. */
  keep: string[]
  /** Ids to withdraw. */
  supersede: string[]
}

/**
 * Everything this call compares, as one string. Tag, title, description,
 * priority, type and items together: two tasks are the same task only if an
 * attorney reading them would learn the same thing.
 *
 * The items are part of it because a checklist whose items changed is a
 * different checklist — and because a checklist someone has *ticked* differs
 * from the freshly-built one, which is what makes the tick a withdrawal
 * rather than a silent rewrite of their progress.
 */
function contentKey(parts: {
  batchTag: string | null
  title: string
  description: string
  priority: string
  taskType: string
  checklist: ChecklistItem[]
}): string {
  return JSON.stringify([
    parts.batchTag,
    parts.title,
    parts.description,
    parts.priority,
    parts.taskType,
    parts.checklist.map((item) => [item.text, item.done]),
  ])
}

/**
 * What a run should create, keep and withdraw — one question, replacing the
 * two functions this used to be.
 *
 * `tasksToSupersede` and `tasksToSupersedeForUnits` split on whether the
 * caller passed the unit ids a retry had touched. Nothing passed them: #411
 * added the mechanism in `retry.ts`, #412 moved `emitTasks` into the tick and
 * dropped the argument, and the result was that a retried run's second
 * done-pass re-created a task for every unit including the ones that never
 * failed. `tasks` has no unique index on `batch_tag`, so the duplicates simply
 * appeared.
 *
 * Asking about content instead of about units removes the need for the hint
 * altogether, and is what makes this idempotent: run it twice over an
 * unchanged run and the second call does nothing at all. A retried unit whose
 * rationale changed no longer matches, so it is withdrawn and re-created; a
 * unit the retry never touched matches exactly, so it keeps its id and its
 * `created_at`. Both `batch_tag` shapes — `prompt:<runId>#<unitId>` for a
 * task set and `prompt:<runId>` for a checklist — fall out of this with
 * neither being special-cased, which is why `parseBatchTag` is gone too.
 *
 * Narrow on the same three axes it always was, for the same reasons:
 *
 *  - `source === PROMPT_TASK_SOURCE` only. A tool may withdraw its own
 *    suggestion; it must never touch a task a person added by hand, or one the
 *    stage engine or the SLA plan is tracking.
 *  - `status === 'open'` only. A `done` task is a record of work that
 *    happened; a `blocked` or `in_progress` one has something underway on it.
 *  - `assigneeId === null` only. The moment someone picks it up, a suggested
 *    task is real work someone is doing, and a newer run not surfacing the
 *    same finding does not make that work moot.
 *
 * What is *not* narrowed, and should be: this is scoped to the matter, not to
 * the prompt. Two prompts emitting tasks on one matter would each withdraw the
 * other's. That was true before this change too — it is invisible only
 * because one prompt emits tasks and the review prompt does not — and fixing
 * it means putting the prompt into the tag, which is its own decision. See
 * the design note.
 */
export function planEmit(existing: ExistingPromptTask[], desired: TaskRow[]): EmitPlan {
  const candidates = existing.filter(
    (task) => task.source === PROMPT_TASK_SOURCE && task.status === 'open' && task.assigneeId === null,
  )

  const byContent = new Map<string, string[]>()
  for (const task of candidates) {
    const key = contentKey({
      batchTag: task.batchTag,
      title: task.title,
      description: task.description,
      priority: task.priority,
      taskType: task.taskType,
      checklist: task.checklist,
    })
    const ids = byContent.get(key)
    if (ids) ids.push(task.id)
    else byContent.set(key, [task.id])
  }

  const keep: string[] = []
  const insert: TaskRow[] = []
  const matched = new Set<string>()

  for (const row of desired) {
    const key = contentKey({
      batchTag: row.batch_tag,
      title: row.title,
      description: row.description,
      priority: row.priority,
      taskType: row.task_type,
      checklist: row.checklist,
    })
    // The first twin not already claimed. A duplicate pair left by the
    // pre-fix bug therefore keeps one and withdraws the other, which is how
    // this self-heals rather than preserving the damage.
    const twin = byContent.get(key)?.find((id) => !matched.has(id))
    if (twin) {
      matched.add(twin)
      keep.push(twin)
    } else {
      insert.push(row)
    }
  }

  const supersede = candidates.filter((task) => !matched.has(task.id)).map((task) => task.id)
  return { insert, keep, supersede }
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
