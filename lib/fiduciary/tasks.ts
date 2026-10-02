import type { MatrixIssue } from './matrix'

/**
 * The `tasks.source` value a fiduciary gap's task carries.
 *
 * `tasks_source_check` allows it (see
 * 20261105000000_fiduciary_task_source.sql). `planFiduciaryEmit` narrows on
 * it, and that has to be a fact the database enforces on every row rather
 * than a convention this module assumes of every caller: the rule's whole job
 * is to withdraw this tool's own suggestions and nothing else.
 */
export const FIDUCIARY_TASK_SOURCE = 'fiduciary'

export interface FiduciaryTaskRow {
  matter_id: string
  source: string
  task_type: string
  auto: boolean
  batch_tag: string
  title: string
  priority: string
}

export interface ExistingFiduciaryTask {
  id: string
  source: string
  batchTag: string | null
  status: string
  assigneeId: string | null
  title: string
  priority: string
  /** Set when a sweep retired the row itself. Optional so callers that only
   *  ever pass open rows need not supply it. */
  closeoutReason?: string | null
}

export interface FiduciaryEmitPlan {
  insert: FiduciaryTaskRow[]
  keep: string[]
  supersede: string[]
}

/** An error is a contradiction that is wrong now; a gap is a hole that shows
 *  itself only when someone cannot serve. A note is neither — see below. */
const PRIORITY_BY_SEVERITY: Record<string, string> = { error: 'high', gap: 'normal' }

/**
 * Everything in a tag before the `#`: this module's own tags, for one matter.
 *
 * One function so `fiduciaryTaskRows` and `planFiduciaryEmit` cannot disagree
 * about what a matter's tags look like — the emitter writing one shape and the
 * withdrawal rule recognising another would leave every task it ever created
 * beyond its own reach, and nothing would fail to say so.
 */
function tagPrefix(matterId: string): string {
  return `${FIDUCIARY_TASK_SOURCE}:${matterId}`
}

function tagFor(matterId: string, issue: MatrixIssue): string | null {
  // A `role` is required; a null `forParty` is not a failure.
  //
  // This asymmetry matters. Two issues are built outside the chain loop:
  // `concentrated`, which has neither field and never becomes a task anyway,
  // and `no_guardian`, which has no chain either but *is* a `gap` and must
  // become one. Requiring both fields would drop the highest-consequence
  // finding on the screen with nothing failing to say so, which is exactly
  // the kind of silence this feature exists to remove. So `no_guardian`
  // carries `role: 'guardian'` and no party — minor children belong to the
  // couple, and a guardian named by either spouse satisfies it, so it is one
  // gap per matter rather than one per party.
  //
  // `both` rather than an omitted segment, so the tag is always three
  // segments and stays parseable — and so the string `null` never reaches
  // stored data.
  if (!issue.role) return null
  return `${tagPrefix(matterId)}#${issue.kind}:${issue.role}:${issue.forParty ?? 'both'}`
}

/**
 * One task per gap worth acting on.
 *
 * The gate is severity, and it is the same shape as `actionableFindings` for
 * prompts: the one place that decides whether a finding may act. Only `error`
 * and `gap` do. `note` never does, and the matrix says why in its own comment
 * — "a spouse holding every office is the normal design of a plan, and calling
 * it a fault would teach the reader to ignore this list". A note that became a
 * task would teach exactly that, and the cost is not the note, it is the
 * credibility of everything else in the queue.
 *
 * The title is the issue's message, which is written to be read by a person.
 * The `batch_tag` is *not* built from it: see `tagFor`.
 */
export function fiduciaryTaskRows(matterId: string, issues: MatrixIssue[]): FiduciaryTaskRow[] {
  return issues.flatMap((issue) => {
    const priority = PRIORITY_BY_SEVERITY[issue.severity]
    if (!priority) return []
    const batchTag = tagFor(matterId, issue)
    if (!batchTag) return []
    return [
      {
        matter_id: matterId,
        source: FIDUCIARY_TASK_SOURCE,
        task_type: 'single',
        auto: true,
        batch_tag: batchTag,
        title: issue.message,
        priority,
      },
    ]
  })
}

/**
 * What this matter's fiduciary tasks should be, against what they are.
 *
 * Deliberately not `planEmit` from `lib/fieldAudit/tasks.ts`, which answers
 * the same shape of question for prompts. Two instances do not justify one
 * abstraction, and that function has just absorbed three separate corrections
 * — a retry duplicating instead of replacing, an uncitable finding retiring a
 * cited one, and one prompt erasing another's tasks. Putting both callers
 * behind a seam nobody has run twice would risk all of that to save a few
 * lines. If a third emitter appears, extract then, with three real cases to
 * design against.
 *
 * The narrowing is the same on every axis, and for the same reasons: this
 * source only, `open` only, unassigned only. A task someone has picked up is
 * real work being done, and no sweep may close it.
 *
 * `matterId` is a parameter rather than something read off `desired[0]`,
 * which is what the plan proposed. A prefix derived from the desired rows
 * cannot exist when `desired` is empty, and empty `desired` is precisely the
 * case that retires tasks — so the one call that withdraws work would have
 * been the one call with no matter scope, falling back on the caller having
 * filtered correctly. The scope this rule needs is not something its input
 * happens to mention; it is the question being asked.
 */
export function planFiduciaryEmit(
  matterId: string,
  existing: ExistingFiduciaryTask[],
  desired: FiduciaryTaskRow[],
): FiduciaryEmitPlan {
  const prefix = `${tagPrefix(matterId)}#`

  const candidates = existing.filter(
    (task) =>
      task.source === FIDUCIARY_TASK_SOURCE &&
      task.status === 'open' &&
      task.assigneeId === null &&
      // This matter's own tags only. The caller passes one matter's tasks, but
      // the rule should not depend on it having filtered correctly — and a tag
      // this module did not write is nobody's to retire. The `#` terminator is
      // what makes the matter segment an exact match rather than a prefix one.
      task.batchTag !== null &&
      task.batchTag.startsWith(prefix),
  )

  const byTag = new Map<string, ExistingFiduciaryTask>()
  for (const task of candidates) {
    // Every candidate has a tag — the filter above required one — and asking
    // again is how that is said in a way the types can follow, rather than
    // asserting it away.
    if (task.batchTag !== null) byTag.set(task.batchTag, task)
  }

  const keep: string[] = []
  const insert: FiduciaryTaskRow[] = []
  const matched = new Set<string>()

  // Rows a person has already settled: picked up, finished, or dismissed.
  // They are not this sweep's to retire (`candidates` excludes them), but they
  // still say this exact thing — so they must stop it being said again. Before
  // this, every one of them was invisible here, and the sweep re-inserted the
  // same task on the next tick after someone completed, assigned or deleted
  // it. A row the sweep retired itself does not count: if that gap returns,
  // it deserves a fresh task.
  const settled = new Set(
    existing
      .filter(
        (task) =>
          task.source === FIDUCIARY_TASK_SOURCE &&
          task.batchTag !== null &&
          task.batchTag.startsWith(prefix) &&
          task.closeoutReason !== 'fiduciary_superseded' &&
          !candidates.includes(task),
      )
      .map((task) => `${task.batchTag}\u0000${task.title}\u0000${task.priority}`),
  )

  for (const row of desired) {
    const twin = byTag.get(row.batch_tag)
    // Same tag *and* same content: the gap is unchanged, so the row stays
    // exactly as it is and keeps its id and `created_at`. Same tag with
    // different wording is a replacement, not a keep.
    if (twin && twin.title === row.title && twin.priority === row.priority) {
      matched.add(twin.id)
      keep.push(twin.id)
    } else if (!settled.has(`${row.batch_tag}\u0000${row.title}\u0000${row.priority}`)) {
      insert.push(row)
    }
  }

  const supersede = candidates.filter((task) => !matched.has(task.id)).map((task) => task.id)
  return { insert, keep, supersede }
}
