import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from '@/lib/supabase/database'
import type { FieldAuditCheck, OutputTarget } from '@aubrey-law/citations/prompt/body'
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
  /** `tasks.checklist` is a `Json` column in the generated types, and a plain
   *  interface is not assignable to `Json` without this. Declared here rather
   *  than cast away at the `insert` call, so the items keep a real type on
   *  every path that reads them. */
  [key: string]: string | boolean
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

const PRIORITY_ORDER: Record<string, number> = { low: 0, normal: 1, high: 2 }

/**
 * The rows one run's findings become, in the shape its prompt version asked
 * for.
 *
 * `findings` is expected to already be `actionableFindings(result)` from
 * `@aubrey-law/citations/fieldAudit/runFieldAudit` — the severity,
 * disposition and verified-reference gate — so nothing here re-checks that.
 * This is the templating step and the shaping step, nothing more.
 *
 * A finding whose check number names nothing in this prompt version is
 * skipped rather than guessed at: the prompt and the result have fallen out
 * of step with each other, and there is no template to fill in.
 */
export function taskRowsFor(
  matterId: string,
  runId: string,
  checks: FieldAuditCheck[],
  findings: FieldAuditFinding[],
  target: OutputTarget,
  promptTitle: string,
): TaskRow[] {
  // Nothing at all, not an empty row. See `emitTasks`, which returns before
  // it reads anything for this target.
  if (target === 'chat') return []

  const checkByNumber = new Map(checks.map((check) => [check.number, check]))
  const bodyOrder = new Map(checks.map((check, index) => [check.number, index]))

  // The body's order, not the findings' arrival order: a playbook's order is
  // the order its author meant.
  const matched = findings
    .flatMap((f) => {
      const check = checkByNumber.get(f.checkNumber)
      return check ? [{ finding: f, check }] : []
    })
    .sort((a, b) => (bodyOrder.get(a.finding.checkNumber) ?? 0) - (bodyOrder.get(b.finding.checkNumber) ?? 0))

  if (target === 'task_set') {
    return matched.map(({ finding, check }) => ({
      matter_id: matterId,
      source: PROMPT_TASK_SOURCE,
      task_type: 'single',
      auto: true,
      // Names both the run and the unit, so a retry can replace one unit's
      // task without touching the rest. `planEmit` compares whole tags and
      // does not parse this, but a person reading the row can.
      batch_tag: `prompt:${runId}#${finding.checkNumber}`,
      title: check.taskTemplate.title,
      // The template says what kind of problem this is; the rationale says
      // what the sheet actually shows.
      description: `${check.taskTemplate.description}\n\n${finding.rationale}`,
      priority: check.taskTemplate.priority,
      checklist: [],
    }))
  }

  // `checklist`: one task for the whole run.
  //
  // No items means no task. An empty checklist says work is needed and then
  // names none, which is worse than saying nothing — and it is what a run
  // whose every finding failed verification would otherwise produce.
  if (matched.length === 0) return []

  const items: ChecklistItem[] = matched.map(({ check }) => ({ text: check.taskTemplate.title, done: false }))

  // The rationales go in the description rather than into the item text: an
  // item is a line someone ticks, and six paragraphs of reasoning is not
  // that. Nothing is lost — the evidence is right underneath.
  const description = [
    `${promptTitle} found ${items.length === 1 ? '1 item' : `${items.length} items`} to confirm on the design sheet.`,
    '',
    ...matched.map(({ finding, check }, index) => `${index + 1}. ${check.taskTemplate.title}\n${finding.rationale}`),
  ].join('\n')

  const priority = matched.reduce(
    (highest, { check }) =>
      (PRIORITY_ORDER[check.taskTemplate.priority] ?? 0) > (PRIORITY_ORDER[highest] ?? 0)
        ? check.taskTemplate.priority
        : highest,
    'low' as string,
  )

  return [
    {
      matter_id: matterId,
      source: PROMPT_TASK_SOURCE,
      task_type: 'checklist',
      auto: true,
      // No unit suffix: there is no single unit a run-level task belongs to.
      batch_tag: `prompt:${runId}`,
      title: promptTitle,
      description,
      priority,
      checklist: items,
    },
  ]
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
 * Everything this call compares, as one string: tag, title, description,
 * priority, type, and the checklist items' text. Byte-identical, not
 * semantically equivalent — the description embeds the model's own rationale,
 * so a re-executed unit churns even when the finding is substantively the
 * same. That is the intended trade; a comparison that tried to judge
 * "substantively the same" would be a second verifier with nothing to verify
 * against.
 *
 * **An item's `done` flag is deliberately excluded.** `planEmit` only inserts
 * and archives — it has no branch that rewrites a row in place. So including
 * `done` would mean a partly-ticked checklist stops matching, gets archived,
 * and is replaced by a blank copy, taking the attorney's progress out of the
 * working queue. Excluding it means the keys match, the row is kept untouched,
 * and the ticks survive along with its id and `created_at`. Nothing is lost:
 * if the findings really changed, the rationales in the description changed
 * with them and the key mismatches on its own merits. `done` differs only when
 * a person changed it, which is the one case that must not cause a withdrawal.
 *
 * The item text is read positionally rather than by stringifying each item
 * object, because `jsonb` sorts object keys on the way in — a stored item
 * comes back as `{"done":…,"text":…}` whatever order it was written in, so
 * stringifying the objects would make every checklist comparison fail
 * forever, silently, from the first real run.
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
    // Text only — see the note above on why `done` is excluded.
    parts.checklist.map((item) => item.text),
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
 * unchanged run and the second call does nothing at all — provided nobody
 * edited the tasks in between, since a hand-edited title or description is a
 * content change like any other.
 *
 * Idempotent *within a run*, to be exact. The tag carries the run id, so a
 * genuinely new run is new content and an unchanged finding still archives and
 * re-inserts. That is what the advisory logic in `lib/runs/advisory.ts`
 * expects — a newer run's answer replaces an older one's — but it means the
 * anti-churn argument below holds only for a run re-emitting its own tasks.
 *
 * A retried unit whose rationale changed no longer matches, so it is withdrawn
 * and re-created; a unit the retry never touched matches exactly, so it keeps
 * its id and its `created_at`. Both `batch_tag` shapes —
 * `prompt:<runId>#<unitId>` for a task set and `prompt:<runId>` for a
 * checklist — fall out of this with neither being special-cased, which is why
 * `parseBatchTag` is gone too.
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
  /** From the run's pinned prompt version body — never the published one. */
  outputTarget: OutputTarget
  /** Titles a `checklist` task. Unused by `task_set`. */
  promptTitle: string
}

export interface EmitTasksResult {
  created: number
  /** Already said exactly this, so left alone — id and `created_at` intact. */
  kept: number
  superseded: number
}

/**
 * Makes this matter's open prompt tasks say what this run says.
 *
 * Reads the existing tasks *before* inserting anything, which is what lets
 * `planEmit` compare against a snapshot that cannot contain rows this call
 * just wrote. The withdrawal happens only after the insert succeeds: if the
 * insert throws, nothing that was open a moment ago has been closed out for a
 * run that never produced its replacements.
 *
 * Safe to call twice. `planEmit` is idempotent over an unchanged run, so a
 * retried run's second pass through the tick creates nothing and withdraws
 * nothing — which is exactly what it did not do before `planEmit` existed.
 */
export async function emitTasks(
  client: SupabaseClient<WorkbenchDatabase>,
  input: EmitTasksInput,
): Promise<EmitTasksResult> {
  // `chat` produces no objects, so it reads nothing and writes nothing. This
  // returns before the query rather than after it on purpose: an empty
  // `desired` would make `planEmit` withdraw every open prompt task on the
  // matter, which is not "produces nothing", it is "destroys someone else's
  // something".
  if (input.outputTarget === 'chat') return { created: 0, kept: 0, superseded: 0 }

  const sb = client

  const { data: existingRows, error: existingError } = await sb
    .from('tasks')
    .select('id, source, batch_tag, status, assignee_id, title, description, priority, task_type, checklist')
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
    title: String(row.title ?? ''),
    description: String(row.description ?? ''),
    priority: String(row.priority ?? ''),
    taskType: String(row.task_type ?? ''),
    checklist: Array.isArray(row.checklist) ? (row.checklist as ChecklistItem[]) : [],
  }))

  const desired = taskRowsFor(
    input.matterId,
    input.runId,
    input.checks,
    input.findings,
    input.outputTarget,
    input.promptTitle,
  )

  const plan = planEmit(existing, desired)

  if (plan.insert.length > 0) {
    const { error: insertError } = await sb.from('tasks').insert(plan.insert)
    if (insertError) throw new Error(`Could not create tasks for this run: ${insertError.message}`)
  }

  if (plan.supersede.length > 0) {
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
      .in('id', plan.supersede)
    if (updateError) throw new Error(`Could not withdraw superseded tasks: ${updateError.message}`)
  }

  return { created: plan.insert.length, kept: plan.keep.length, superseded: plan.supersede.length }
}
