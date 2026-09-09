import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from '@/lib/supabase/database'
import type { FieldAuditCheck, OutputTarget } from '@aubrey-law/citations/prompt/body'
import type { FieldAuditFinding } from '@aubrey-law/citations/fieldAudit/types'
import { isActionable, runAnswers, type RunAnswers } from '@aubrey-law/citations/fieldAudit/runFieldAudit'

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
 * A checklist item as `public.tasks.checklist` holds them.
 *
 * A `type` rather than an `interface` on purpose. The generated column type
 * is `Json`, and TypeScript synthesises an implicit index signature for an
 * object *type alias* but not for an *interface* — so this is assignable to
 * `Json` with no cast at the `insert`, while still rejecting an excess
 * property. As an interface it would need an explicit
 * `[key: string]: string | boolean` to satisfy `Json`, and that signature
 * would then quietly accept any misspelled field. Nothing extends or
 * re-opens this type, so the interface bought nothing.
 *
 * Declared here rather than imported from the root app's
 * `lib/tasks/types.ts`: that is a separate app whose `@/*` resolves to a
 * different root, and the shared contract is the column, not a TypeScript
 * file across an app boundary.
 */
export type ChecklistItem = {
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

const PRIORITY_ORDER: Record<string, number> = { low: 0, normal: 1, high: 2 }

/**
 * The rows one run's findings become, in the shape its prompt version asked
 * for.
 *
 * `findings` is expected to already be gated — the severity, disposition and
 * verified-reference test `isActionable` in
 * `@aubrey-law/citations/fieldAudit/runFieldAudit` applies — so nothing here
 * re-checks that. This is the templating step and the shaping step, nothing
 * more.
 *
 * That gate is now applied by `emitTasks` immediately below rather than by
 * whoever calls it, which is deliberate: one source of truth for what may
 * act. A caller free to gate for itself is a caller free to gate differently,
 * and `emitTasks` also has to hand the *ungated* outcomes to the withdrawal
 * rule — so it is the one place that knows both, and the only place that
 * should decide.
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
      // task without touching the rest. `planEmit` matches on whole tags, and
      // takes this one apart only to ask whether the run answered that check
      // before retiring it — see `parseBatchTag`.
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
    // No "on the design sheet": this templates every prompt in the library,
    // and 39 of the coming 40 are not that prompt. The title says what ran.
    `${promptTitle} found ${items.length === 1 ? '1 item' : `${items.length} items`} to confirm.`,
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
  /**
   * The prompt this task's run belonged to, resolved by `emitTasks` through
   * `workflow_runs.prompt_version_id` → `prompt_versions.prompt_id`. `null`
   * when the run no longer exists or the tag does not parse — in which case
   * the task is nobody's to retire and stands.
   */
  promptId: string | null
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
  /**
   * The same task, saying it differently — rewritten in place.
   *
   * Only the description can land here, because everything else `contentKey`
   * ever compared is identity: change the title, the priority, the type or an
   * item's text and it is a different task, replaced as before. The
   * description is different in kind — it embeds the model's own rationale,
   * which is rephrased on essentially every run even when the finding is
   * identical.
   *
   * Without this branch that rephrasing archived the row and inserted a blank
   * copy, and the attorney's ticks went with it. Measured 2026-09-08: two runs
   * on an unchanged sheet produced identical outcomes and identical titles,
   * priorities and items, differing only in a 599-vs-572-character
   * description — and a hand-ticked item came back unticked.
   */
  update: Array<{ id: string; description: string }>
  /** Ids to withdraw. */
  supersede: string[]
}

/**
 * Everything this call compares, as one string: the task's *stable identity*,
 * title, description, priority, type, and the checklist items' text. Byte-identical, not
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
/**
 * What makes two tasks *the same task*, from a tag that also records which run
 * produced one.
 *
 * `batch_tag` does two jobs: it says which unit a task is about, and which run
 * noticed it. Only the first is identity. Comparing whole tags made every
 * re-run of an unchanged finding a content change, so the keep path could
 * never fire across runs and each run archived its predecessor's task and
 * inserted a blank copy — taking any ticks with it. Measured 2026-09-08: 20
 * runs on one unchanged sheet left 19 archived rows, and a deliberately ticked
 * checklist came back unticked on the very next run.
 *
 * A tag this module did not write keeps its raw value, so a stranger's task
 * can never collide with one of ours.
 */
function identityOf(tag: string | null): string {
  const parsed = parseBatchTag(tag)
  if (parsed === null) return `raw:${tag ?? ''}`
  return parsed.unitId === null ? 'unit:(run-level)' : `unit:${parsed.unitId}`
}

function identityKey(parts: {
  batchTag: string | null
  title: string
  priority: string
  taskType: string
  checklist: ChecklistItem[]
}): string {
  return JSON.stringify([
    identityOf(parts.batchTag),
    parts.title,
    parts.priority,
    parts.taskType,
    // Text only — see the note above on why `done` is excluded.
    parts.checklist.map((item) => item.text),
  ])
}

/**
 * Pulls the run id and, if present, the unit id out of a `batch_tag`.
 *
 * Deleted when `planEmit` replaced the two superseding functions, because
 * comparing whole tags made both shapes work with no second code path.
 * Reinstated because the withdrawal rule genuinely needs the unit: "did this
 * run clear check 7" cannot be asked of a tag that has not been taken apart.
 * Returns `null` for a tag that fits neither shape — such a tag was not
 * written by this module, and is never this run's to retire.
 */
function parseBatchTag(tag: string | null): { runId: string; unitId: string | null } | null {
  if (!tag) return null
  const match = /^prompt:([^#]+)(?:#(.+))?$/.exec(tag)
  if (!match) return null
  return { runId: match[1], unitId: match[2] ?? null }
}

/**
 * Whether this run is entitled to withdraw one earlier task.
 *
 * The rule the design note states, in order. Everything not covered here
 * stands, which is the change: a run used to retire anything it did not
 * re-state, and a finding refused by the verification gate looks exactly like
 * a check the run cleared. One is evidence of absence, the other absence of
 * evidence, and only the first is grounds for closing someone's work.
 */
function mayRetire(
  task: ExistingPromptTask,
  answers: RunAnswers,
  desiredTags: Set<string>,
  desiredUnits: Set<string>,
  desiredItemText: Set<string>,
): boolean {
  // 0. Replacement. A desired row carries this exact tag, so the run is
  //    rewriting its own answer rather than retiring one on the strength of
  //    silence. First because it is what stops a retry inserting a second task
  //    beside the one it means to replace.
  if (task.batchTag !== null && desiredTags.has(task.batchTag)) return true

  // A tag of neither shape was not written by this module. Asked before
  // `authoritative`, not after: a complete answer is a complete answer about
  // *this prompt version's checks*, which says nothing whatever about a row
  // some other tool tagged. Nothing this module emits can reach here — both
  // shapes parse — so this only ever spares a stranger's task.
  const parsed = parseBatchTag(task.batchTag)
  if (parsed === null) return false

  // A complete answer may retire prior work.
  if (answers.authoritative) return true

  if (parsed.unitId !== null) {
    // This run either says that check is fine, or is re-reporting it — in
    // which case the new row replaces the old one in substance even though
    // the run ids differ.
    return answers.byCheck[parsed.unitId] === 'cleared' || desiredUnits.has(parsed.unitId)
  }

  // A run-level (checklist) tag names no single check, so its *items* are the
  // only per-check signal available: if this run's items repeat all of them,
  // the new task already says everything the old one said. Item text is the
  // check's `taskTemplate.title`, fixed by the prompt version, so it is stable
  // across runs and this comparison means something.
  //
  // No items means no signal at all — a suffix-less tag from before the unit
  // suffix existed, or a task built some other way — so it stands rather than
  // falling back to the old behaviour.
  if (task.checklist.length === 0) return false
  return task.checklist.every((item) => desiredItemText.has(item.text))
}

/**
 * The run `planEmit` is deciding for: which prompt it belongs to, and what it
 * concluded.
 *
 * An object rather than two positional arguments because both describe the
 * same thing and a fourth positional would read as noise at every call site —
 * and because the next thing this decision needs should not churn them all
 * again.
 */
export interface PlanEmitRun {
  /** Only this prompt's tasks are this run's to touch. */
  promptId: string
  answers: RunAnswers
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
 * Idempotent across runs, not merely within one. It used to be within-run
 * only: the tag carries the run id, so an unchanged finding read as new
 * content every time and each run archived its predecessor's task and inserted
 * a blank copy. That was justified here as what `lib/runs/advisory.ts`
 * expects — and it is not: that module reads `workflow_findings`,
 * `workflow_runs`, `prompt_versions` and `matters`, and never touches `tasks`,
 * `batch_tag` or a checklist at all. Nothing outside this module reads the run
 * id in a tag.
 *
 * What the churn did cost is an attorney's ticks, every time. Measured
 * 2026-09-08 on one unchanged sheet: 20 runs, 19 archived rows, and an item
 * ticked by hand came back unticked on the next run. It mattered little while
 * the whole database held a single run; the audit now fires on five stages, so
 * a re-run is ordinary.
 *
 * `identityOf` is what changed. The tag still records which run produced a
 * task — a kept task therefore names the run that *first* found the thing,
 * which is the more useful fact anyway — but identity is the unit, so an
 * unchanged finding keeps its row, its id, its `created_at` and its ticks.
 *
 * A retried unit whose rationale changed no longer matches, so it is withdrawn
 * and re-created; a unit the retry never touched matches exactly, so it keeps
 * its id and its `created_at`. Both `batch_tag` shapes —
 * `prompt:<runId>#<unitId>` for a task set and `prompt:<runId>` for a
 * checklist — fall out of the content comparison with neither being
 * special-cased. Only the withdrawal rule below tells them apart.
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
 * Narrowed on a fourth axis as well: the prompt. Only this run's own prompt's
 * tasks are its to touch, so two prompts emitting on one matter no longer
 * withdraw each other's on every run. The scope is the prompt and not the
 * version — version 4 still retires version 3's tasks, being a newer answer to
 * the same question — and a candidate whose prompt could not be resolved
 * matches nothing and stands, since it is nobody's to retire.
 *
 * What it may **not** do, which is the point of the `answers` argument: retire
 * a task on the strength of having said nothing about it. A finding the
 * verification gate refused produces no row, exactly like a check the run
 * cleared — and until that distinction existed, an uncitable blocker retired a
 * cited one. See `mayRetire` above and the design note.
 */
export function planEmit(existing: ExistingPromptTask[], desired: TaskRow[], run: PlanEmitRun): EmitPlan {
  const candidates = existing.filter(
    (task) =>
      task.source === PROMPT_TASK_SOURCE &&
      task.status === 'open' &&
      task.assigneeId === null &&
      // Another prompt's tasks are not this run's to touch — not to retire,
      // and not to claim as a twin either, since an identical row from another
      // prompt would otherwise suppress this run's own insert. A `null`
      // `promptId` never matches, which is the intended fail-safe.
      task.promptId === run.promptId,
  )

  const byIdentity = new Map<string, string[]>()
  const byId = new Map<string, ExistingPromptTask>()
  for (const task of candidates) {
    byId.set(task.id, task)
    const key = identityKey({
      batchTag: task.batchTag,
      title: task.title,
      priority: task.priority,
      taskType: task.taskType,
      checklist: task.checklist,
    })
    const ids = byIdentity.get(key)
    if (ids) ids.push(task.id)
    else byIdentity.set(key, [task.id])
  }

  const keep: string[] = []
  const update: Array<{ id: string; description: string }> = []
  const insert: TaskRow[] = []
  const matched = new Set<string>()

  for (const row of desired) {
    const key = identityKey({
      batchTag: row.batch_tag,
      title: row.title,
      priority: row.priority,
      taskType: row.task_type,
      checklist: row.checklist,
    })
    // The first twin not already claimed. A duplicate pair left by the
    // pre-fix bug therefore keeps one and withdraws the other, which is how
    // this self-heals rather than preserving the damage.
    const twin = byIdentity.get(key)?.find((id) => !matched.has(id))
    if (twin) {
      matched.add(twin)
      // Same task. Either it already says this, or it says it differently and
      // the wording is rewritten in place — never archived, so the row keeps
      // its id, its `created_at` and whatever the attorney has ticked.
      if (byId.get(twin)?.description === row.description) keep.push(twin)
      else update.push({ id: twin, description: row.description })
    } else {
      insert.push(row)
    }
  }

  const desiredTags = new Set(desired.map((row) => row.batch_tag))
  const desiredUnits = new Set(
    desired.flatMap((row) => {
      const parsed = parseBatchTag(row.batch_tag)
      return parsed?.unitId ? [parsed.unitId] : []
    }),
  )
  const desiredItemText = new Set(desired.flatMap((row) => row.checklist.map((item) => item.text)))

  const supersede = candidates
    .filter((task) => !matched.has(task.id))
    .filter((task) => mayRetire(task, run.answers, desiredTags, desiredUnits, desiredItemText))
    .map((task) => task.id)
  return { insert, keep, update, supersede }
}

export interface EmitTasksInput {
  matterId: string
  runId: string
  checks: FieldAuditCheck[]
  /**
   * *All* of the run's findings, not the gated subset. `emitTasks` applies
   * the gate itself, because the withdrawal rule needs the outcomes the gate
   * discards: a `compliant` check is what entitles this run to retire an
   * earlier task, and it never survives `isActionable`.
   */
  findings: FieldAuditFinding[]
  /** Units whose step did not succeed — they answered nothing, so they retire nothing. */
  failedCheckNumbers: string[]
  /** From the run's pinned prompt version body — never the published one. */
  outputTarget: OutputTarget
  /** Titles a `checklist` task. Unused by `task_set`. */
  promptTitle: string
  /**
   * The prompt this run belongs to — only its own tasks are this run's to
   * touch. Read off the run's pinned prompt version, so it is the prompt that
   * actually produced this run rather than whatever is published now.
   */
  promptId: string
}

export interface EmitTasksResult {
  created: number
  /** Already said exactly this, so left alone — id and `created_at` intact. */
  kept: number
  /** The same task, rephrased in place — id, `created_at` and ticks intact. */
  updated: number
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
  if (input.outputTarget === 'chat') return { created: 0, kept: 0, updated: 0, superseded: 0 }

  const sb = client

  const { data: existingRows, error: existingError } = await sb
    .from('tasks')
    .select('id, source, batch_tag, status, assignee_id, title, description, priority, task_type, checklist')
    .eq('matter_id', input.matterId)
    .eq('source', PROMPT_TASK_SOURCE)
  if (existingError) {
    throw new Error(`Could not load this matter's earlier prompt tasks: ${existingError.message}`)
  }

  // Which prompt each of these tasks came from. The tag carries the run id and
  // the run carries the version, so the prompt is two hops away — and it is
  // the database rather than the tag that is authoritative about it, which is
  // why the tag was not given a third shape to carry it. A task whose run has
  // gone resolves to nothing and is therefore nobody's to retire.
  //
  // Plain selects rather than one PostgREST embedded select, because
  // `scripts/lib/queryReferences.mjs` cannot read columns through an embedded
  // form — an embedded select here would drop these columns out of both
  // `query-columns.test.ts` and the live `checkDbColumns.mjs` check. The same
  // trade `loadPublishedPrompt` and `lib/review/history.ts` already make.
  const candidateRunIds = [
    ...new Set(
      (existingRows ?? []).flatMap((row) => {
        const parsed = parseBatchTag((row.batch_tag as string | null) ?? null)
        return parsed ? [parsed.runId] : []
      }),
    ),
  ]

  const promptByRunId = new Map<string, string>()
  if (candidateRunIds.length > 0) {
    const { data: runRows, error: runsError } = await sb
      .from('workflow_runs')
      .select('id, prompt_version_id')
      .in('id', candidateRunIds)
    if (runsError) {
      throw new Error(`Could not resolve the runs behind this matter's prompt tasks: ${runsError.message}`)
    }

    const versionIds = [
      ...new Set(
        (runRows ?? []).flatMap((row) => (row.prompt_version_id ? [String(row.prompt_version_id)] : [])),
      ),
    ]

    if (versionIds.length > 0) {
      const { data: versionRows, error: versionsError } = await sb
        .from('prompt_versions')
        .select('id, prompt_id')
        .in('id', versionIds)
      if (versionsError) {
        throw new Error(`Could not resolve the prompts behind this matter's prompt tasks: ${versionsError.message}`)
      }

      const promptByVersionId = new Map(
        (versionRows ?? []).map((row) => [String(row.id), String(row.prompt_id)]),
      )
      for (const row of runRows ?? []) {
        const promptId = row.prompt_version_id
          ? promptByVersionId.get(String(row.prompt_version_id))
          : undefined
        if (promptId) promptByRunId.set(String(row.id), promptId)
      }
    }
  }

  const existing: ExistingPromptTask[] = (existingRows ?? []).map((row) => ({
    id: String(row.id),
    source: String(row.source),
    batchTag: (row.batch_tag as string | null) ?? null,
    promptId: (() => {
      const parsed = parseBatchTag((row.batch_tag as string | null) ?? null)
      return parsed ? promptByRunId.get(parsed.runId) ?? null : null
    })(),
    status: String(row.status),
    assigneeId: (row.assignee_id as string | null) ?? null,
    title: String(row.title ?? ''),
    description: String(row.description ?? ''),
    priority: String(row.priority ?? ''),
    taskType: String(row.task_type ?? ''),
    checklist: Array.isArray(row.checklist) ? (row.checklist as ChecklistItem[]) : [],
  }))

  const answers = runAnswers({
    checkNumbers: input.checks.map((check) => check.number),
    findings: input.findings,
    failedCheckNumbers: input.failedCheckNumbers,
  })

  const desired = taskRowsFor(
    input.matterId,
    input.runId,
    input.checks,
    input.findings.filter(isActionable),
    input.outputTarget,
    input.promptTitle,
  )

  const plan = planEmit(existing, desired, { promptId: input.promptId, answers })

  if (plan.insert.length > 0) {
    const { error: insertError } = await sb.from('tasks').insert(plan.insert)
    if (insertError) throw new Error(`Could not create tasks for this run: ${insertError.message}`)
  }

  // One statement per row rather than an upsert: an upsert would need the
  // whole row, and sending a fresh `checklist` is exactly how the ticks would
  // be lost again. Only the description moves.
  for (const change of plan.update) {
    const { error: rewriteError } = await sb
      .from('tasks')
      .update({ description: change.description })
      .eq('id', change.id)
    if (rewriteError) {
      throw new Error(`Could not update the wording of task ${change.id}: ${rewriteError.message}`)
    }
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

  return {
    created: plan.insert.length,
    kept: plan.keep.length,
    updated: plan.update.length,
    superseded: plan.supersede.length,
  }
}
