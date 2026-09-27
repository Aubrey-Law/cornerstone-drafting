import type { SupabaseClient } from '@supabase/supabase-js'
import type { GeneratedDatabase } from '@/types/supabase'
import { buildMatrix, matrixIssues } from './matrix'
import { loadFiduciaries } from './repository'
import {
  FIDUCIARY_TASK_SOURCE,
  type ExistingFiduciaryTask,
  fiduciaryTaskRows,
  planFiduciaryEmit,
} from './tasks'

export interface FiduciarySweepResult {
  /** Matters whose appointments were read, and so could be judged at all. */
  mattersConsidered: number
  created: number
  /** Already said exactly this, so left alone — id and `created_at` intact. */
  kept: number
  superseded: number
  /**
   * Matters left exactly as they were because something about them could not
   * be read or written. Not "nothing to do": see the loop's own comment.
   */
  skipped: number
}

/**
 * Makes every hired matter's open fiduciary tasks say what the matrix says.
 *
 * Unqueued, and run on every tick rather than through the run queue. That is
 * a deliberate trade, not an oversight: `loadFiduciaries` is four queries for
 * every matter at once regardless of how many there are, there is no model
 * call anywhere in this path, and `planFiduciaryEmit` compares by content
 * first — so a matter nobody has touched costs one read and no writes at all.
 * The machinery needed to schedule, claim and reap one sweep would cost more
 * than the sweep it saved.
 *
 * The order within a matter is read, insert, then withdraw, the same as
 * `lib/fieldAudit/tasks.ts`'s `emitTasks` and for the same reason: the plan is
 * computed against a snapshot that cannot contain rows this call just wrote,
 * and nothing that was open a moment ago is closed out until its replacement
 * has actually landed.
 *
 * A failure to load the appointments propagates. This function has no way to
 * report "I could not tell" through its counts — every field it returns is a
 * number of matters acted upon, and an all-zero result reads as a clean pass
 * over a quiet queue. Throwing is how the caller learns the difference, and
 * the tick catches it: see `app/api/cron/tick/route.ts`.
 */
export async function sweepFiduciaryTasks(
  client: SupabaseClient<GeneratedDatabase>,
): Promise<FiduciarySweepResult> {
  const sb = client

  // Every hired matter's appointments, in one batch. If any of these queries
  // fails, `loadFiduciaries` throws and this function throws with it — so no
  // matter is ever judged against appointments that only *look* absent. An
  // empty issue list from a successful load means the gaps are filled and the
  // tasks should retire; an empty issue list because a query failed means
  // nothing of the kind, and the two must never reach `planFiduciaryEmit` as
  // the same thing. They are both an empty array, which is exactly how a
  // finding verified against four design-sheet fields once became invisible.
  const matters = await loadFiduciaries(sb)

  const result: FiduciarySweepResult = {
    mattersConsidered: matters.length,
    created: 0,
    kept: 0,
    superseded: 0,
    skipped: 0,
  }

  for (const matter of matters) {
    const issues = matrixIssues(buildMatrix(matter.appointments), {
      minorChildren: matter.minorChildren,
    })
    const desired = fiduciaryTaskRows(matter.matterId, issues)

    try {
      const { data: existingRows, error: existingError } = await sb
        .from('tasks')
        .select('id, source, batch_tag, status, assignee_id, title, priority')
        .eq('matter_id', matter.matterId)
        .eq('source', FIDUCIARY_TASK_SOURCE)
      if (existingError) {
        throw new Error(
          `Could not load this matter's earlier fiduciary tasks: ${existingError.message}`,
        )
      }

      const existing: ExistingFiduciaryTask[] = (existingRows ?? []).map((row) => ({
        id: String(row.id),
        source: String(row.source),
        batchTag: (row.batch_tag as string | null) ?? null,
        status: String(row.status),
        assigneeId: (row.assignee_id as string | null) ?? null,
        title: String(row.title ?? ''),
        priority: String(row.priority ?? ''),
      }))

      const plan = planFiduciaryEmit(matter.matterId, existing, desired)

      if (plan.insert.length > 0) {
        const { error: insertError } = await sb.from('tasks').insert(plan.insert)
        if (insertError) {
          throw new Error(`Could not create fiduciary tasks: ${insertError.message}`)
        }
      }
      // Counted where the work actually landed rather than all at the end, so
      // a withdrawal that fails after a successful insert still reports the
      // rows that were written.
      result.created += plan.insert.length
      result.kept += plan.keep.length

      if (plan.supersede.length > 0) {
        const { error: updateError } = await sb
          .from('tasks')
          .update({
            // Not a distinct 'skipped' status — see the header comment in
            // 20261029000000_prompt_task_source.sql for why this reuses the
            // archived + skipped_at pair `lib/tasks/types.ts`'s
            // `isTaskSkipped` already defines as "skipped" everywhere else.
            status: 'archived',
            skipped_at: new Date().toISOString(),
            // Its own reason rather than 'prompt_superseded', which would
            // claim a prompt run retired a row no prompt ever created. Added
            // to `tasks_closeout_reason_check` in
            // 20261105000000_fiduciary_task_source.sql.
            closeout_reason: 'fiduciary_superseded',
          })
          .in('id', plan.supersede)
        if (updateError) {
          throw new Error(`Could not withdraw superseded fiduciary tasks: ${updateError.message}`)
        }
      }
      result.superseded += plan.supersede.length
    } catch (error) {
      // One matter's trouble is that matter's alone: the sweep moves on,
      // because the other matters should not go unswept because this one had
      // a bad minute. Nothing is undone and nothing is retried — the next
      // tick recomputes the plan from scratch, and `planFiduciaryEmit` is
      // idempotent, so whatever landed before the failure is simply where
      // this matter now stands.
      //
      // What the ordering above guarantees is the half that matters: a matter
      // that failed before or during its insert has had nothing withdrawn,
      // because a task whose replacement could not be written is still the
      // best record of the gap it names.
      //
      // Logged rather than swallowed silently. The counts say a matter was
      // skipped but not which or why, and a matter that is skipped on every
      // tick is a real fault that nothing else in this path would report.
      result.skipped += 1
      console.error(
        `[fiduciary sweep] skipped ${matter.matterId}:`,
        error instanceof Error ? error.message : error,
      )
    }
  }

  return result
}
