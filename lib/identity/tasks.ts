import type { IdentityIssue } from './matrix'

/**
 * The `tasks.source` value a name disagreement's task carries.
 *
 * `tasks_source_check` allows it, and `planIdentityEmit` narrows on it. That
 * has to be a fact the database enforces on every row rather than a convention
 * this module assumes of every caller: the rule's whole job is to withdraw
 * this tool's own suggestions and nothing else.
 */
export const IDENTITY_TASK_SOURCE = 'identity'

export interface IdentityTaskRow {
  matter_id: string
  source: string
  task_type: string
  auto: boolean
  batch_tag: string
  title: string
  priority: string
}

export interface ExistingIdentityTask {
  id: string
  source: string
  batchTag: string | null
  status: string
  assigneeId: string | null
  title: string
  priority: string
}

export interface IdentityEmitPlan {
  insert: IdentityTaskRow[]
  keep: string[]
  supersede: string[]
}

/**
 * Everything in a tag before the `#`: this module's own tags, for one matter.
 *
 * One function so `identityTaskRowFor` and `planIdentityEmit` cannot disagree
 * about what a matter's tags look like — the emitter writing one shape and the
 * withdrawal rule recognising another would leave every task it ever created
 * beyond its own reach, and nothing would fail to say so.
 */
function tagPrefix(matterId: string): string {
  return `${IDENTITY_TASK_SOURCE}:${matterId}`
}

/**
 * The task one issue becomes.
 *
 * The tag is the matter and the kind — never a run id, and never a name. A
 * run-keyed tag is what made the prompt path archive and re-insert every task
 * on every run, discarding attorneys' checklist ticks until #433 and #434; the
 * fiduciary path builds its tag from the matter on purpose and its sweep is
 * idempotent because of it. And a name in a `batch_tag` would put privileged
 * content in a column read for grouping and filtering.
 *
 * The title carries both names, because the comparison *is* the finding — an
 * attorney reading "the matter name disagrees with the sheet" and having to
 * open two records to learn how has been told almost nothing.
 *
 * One severity, unlike `lib/fiduciary/tasks.ts`, which maps three: the matrix
 * grades nothing here because the owner's ruling is that every one of these is
 * worth the same attention, and a lookup with a single key would be ceremony.
 */
export function identityTaskRowFor(issue: IdentityIssue): IdentityTaskRow {
  return {
    matter_id: issue.matterId,
    source: IDENTITY_TASK_SOURCE,
    task_type: 'single',
    auto: true,
    batch_tag: `${tagPrefix(issue.matterId)}#name`,
    title: `Matter is filed as “${issue.matterPerson}” but the design sheet drafts for “${issue.sheetClientName}”`,
    priority: 'high',
  }
}

/**
 * What this sweep should create, keep and withdraw for one matter.
 *
 * Narrow on the same axes the fiduciary sweep is, for the same reasons: this
 * source only, `open` only, unassigned only. A tool may withdraw its own
 * suggestion, and must never touch a task a person created, completed, or
 * picked up — a task someone holds is real work being done.
 *
 * `matterId` is a parameter rather than something read off `desired[0]`: a
 * prefix derived from the desired rows cannot exist when `desired` is empty,
 * and empty `desired` is precisely the case that retires tasks. The scope this
 * rule needs is not something its input happens to mention; it is the question
 * being asked.
 */
export function planIdentityEmit(
  matterId: string,
  existing: ExistingIdentityTask[],
  desired: IdentityTaskRow[],
): IdentityEmitPlan {
  const prefix = `${tagPrefix(matterId)}#`

  const candidates = existing.filter(
    (task) =>
      task.source === IDENTITY_TASK_SOURCE &&
      task.status === 'open' &&
      task.assigneeId === null &&
      // This matter's own tags only. A tag this module did not write is
      // nobody's to retire, and the `#` terminator makes the matter segment an
      // exact match rather than a prefix one, so `m1` never claims a task
      // belonging to `m10`.
      task.batchTag !== null &&
      task.batchTag.startsWith(prefix),
  )

  const byTag = new Map<string, ExistingIdentityTask>()
  for (const task of candidates) {
    // Every candidate has a tag — the filter above required one — and asking
    // again is how that is said in a way the types can follow, rather than
    // asserting it away.
    if (task.batchTag !== null) byTag.set(task.batchTag, task)
  }

  const keep: string[] = []
  const insert: IdentityTaskRow[] = []
  const matched = new Set<string>()

  for (const row of desired) {
    const twin = byTag.get(row.batch_tag)
    // Same tag and same wording: unchanged, so the row keeps its id and its
    // `created_at`. Same tag, different wording: the names moved, so replace.
    if (twin && twin.title === row.title && twin.priority === row.priority) {
      matched.add(twin.id)
      keep.push(twin.id)
    } else {
      insert.push(row)
    }
  }

  const supersede = candidates.filter((task) => !matched.has(task.id)).map((task) => task.id)
  return { insert, keep, supersede }
}
