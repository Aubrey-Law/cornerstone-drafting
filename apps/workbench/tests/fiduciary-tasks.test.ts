import { describe, expect, it } from 'vitest'
import {
  FIDUCIARY_TASK_SOURCE,
  fiduciaryTaskRows,
  planFiduciaryEmit,
  type ExistingFiduciaryTask,
} from '@/lib/fiduciary/tasks'
import type { MatrixIssue } from '@/lib/fiduciary/matrix'

const MATTER = 'matter-1'

function issue(over: Partial<MatrixIssue> = {}): MatrixIssue {
  return {
    kind: 'no_successor',
    severity: 'gap',
    message: 'Trustee for the client has no successor.',
    role: 'trustee',
    forParty: 'client',
    ...over,
  }
}

function existing(over: Partial<ExistingFiduciaryTask> = {}): ExistingFiduciaryTask {
  return {
    id: 'task-1',
    source: FIDUCIARY_TASK_SOURCE,
    batchTag: `fiduciary:${MATTER}#no_successor:trustee:client`,
    status: 'open',
    assigneeId: null,
    title: 'Trustee for the client has no successor.',
    priority: 'normal',
    ...over,
  }
}

describe('fiduciaryTaskRows', () => {
  it('makes one row per gap, tagged by kind, role and party', () => {
    const rows = fiduciaryTaskRows(MATTER, [issue()])
    expect(rows).toHaveLength(1)
    expect(rows[0].source).toBe(FIDUCIARY_TASK_SOURCE)
    expect(rows[0].batch_tag).toBe(`fiduciary:${MATTER}#no_successor:trustee:client`)
    expect(rows[0].task_type).toBe('single')
    expect(rows[0].auto).toBe(true)
  })

  /**
   * The matrix's own comment is explicit about why `note` exists: "a spouse
   * holding every office is the normal design of a plan, and calling it a
   * fault would teach the reader to ignore this list". A note that became a
   * task would do exactly that, and cost the queue its credibility.
   */
  it('never makes a task from a note', () => {
    expect(fiduciaryTaskRows(MATTER, [issue({ kind: 'concentrated', severity: 'note', role: null, forParty: null })])).toEqual([])
  })

  /**
   * The same refusal, with the severity gate as the only thing that can be
   * doing the refusing.
   *
   * The test above passes a `concentrated` issue exactly as the matrix builds
   * it, and that issue has no role — so the role guard drops it and the
   * severity gate is never reached. Letting `note` through the gate leaves
   * that test green, which was measured, not assumed. Today no `note` carries
   * a role, but nothing stops one from doing so — `concentrated` is about a
   * person, and a later change naming the office they hold would be an
   * unremarkable one — and on that day the gate would be all that stood
   * between a normal plan and a task calling it a fault.
   */
  it('never makes a task from a note even when the note has a role and a party', () => {
    expect(fiduciaryTaskRows(MATTER, [issue({ severity: 'note', role: 'trustee', forParty: 'client' })])).toEqual([])
  })

  it('makes tasks from both error and gap', () => {
    const rows = fiduciaryTaskRows(MATTER, [
      issue({ severity: 'gap' }),
      issue({ kind: 'duplicate', severity: 'error', role: 'personal_rep' }),
    ])
    expect(rows).toHaveLength(2)
  })

  it('gives an error high priority and a gap normal', () => {
    // An error is a contradiction that is wrong now; a gap is a hole that
    // shows itself when someone cannot serve.
    expect(fiduciaryTaskRows(MATTER, [issue({ kind: 'duplicate', severity: 'error' })])[0].priority).toBe('high')
    expect(fiduciaryTaskRows(MATTER, [issue({ severity: 'gap' })])[0].priority).toBe('normal')
  })

  /** A tag with `undefined` in it is not an identity. */
  it('refuses to build a row for an issue with no role', () => {
    expect(fiduciaryTaskRows(MATTER, [issue({ role: null })])).toEqual([])
  })

  /**
   * But a null party is not a failure. `no_guardian` is built outside the
   * chain loop and has no party — minor children belong to the couple, and a
   * guardian named by either spouse satisfies it — yet it is a `gap` and must
   * become a task. Requiring both fields would have dropped the
   * highest-consequence gap on the screen with nothing failing to say so.
   */
  it('tags an issue with no party as covering both', () => {
    const rows = fiduciaryTaskRows(MATTER, [
      issue({ kind: 'no_guardian', severity: 'gap', role: 'guardian', forParty: null }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].batch_tag).toBe(`fiduciary:${MATTER}#no_guardian:guardian:both`)
  })

  /**
   * The tag must not move when a person is renamed — that is the whole reason
   * `role` and `forParty` were carried out of the matrix.
   */
  it('keeps the tag stable when only the message changes', () => {
    const before = fiduciaryTaskRows(MATTER, [issue({ message: 'If Jane cannot serve…' })])[0]
    const after = fiduciaryTaskRows(MATTER, [issue({ message: 'If Janet cannot serve…' })])[0]
    expect(after.batch_tag).toBe(before.batch_tag)
  })
})

describe('planFiduciaryEmit', () => {
  it('inserts a gap that has no task yet', () => {
    const plan = planFiduciaryEmit(MATTER, [], fiduciaryTaskRows(MATTER, [issue()]))
    expect(plan.insert).toHaveLength(1)
    expect(plan.keep).toEqual([])
    expect(plan.supersede).toEqual([])
  })

  /** A gap that persists keeps its task, so the attorney's place in it
   *  survives every sweep — id and created_at intact. */
  it('keeps a task whose gap still stands', () => {
    const plan = planFiduciaryEmit(MATTER, [existing()], fiduciaryTaskRows(MATTER, [issue()]))
    expect(plan.insert).toEqual([])
    expect(plan.keep).toEqual(['task-1'])
    expect(plan.supersede).toEqual([])
  })

  it('retires a task whose gap has been filled', () => {
    const plan = planFiduciaryEmit(MATTER, [existing()], [])
    expect(plan.supersede).toEqual(['task-1'])
  })

  it('replaces a task whose message changed under the same tag', () => {
    const plan = planFiduciaryEmit(MATTER, [existing({ title: 'Older wording.' })], fiduciaryTaskRows(MATTER, [issue()]))
    expect(plan.keep).toEqual([])
    expect(plan.supersede).toEqual(['task-1'])
    expect(plan.insert).toHaveLength(1)
  })

  it('never touches a task someone made, holds, or has moved on', () => {
    const plan = planFiduciaryEmit(
      MATTER,
      [
        existing({ id: 'manual', source: 'manual' }),
        existing({ id: 'assigned', assigneeId: 'user-1' }),
        existing({ id: 'done', status: 'done' }),
        existing({ id: 'in-progress', status: 'in_progress' }),
      ],
      [],
    )
    expect(plan.supersede).toEqual([])
  })

  it('never touches a task tagged for another matter', () => {
    const theirs = existing({ id: 'theirs', batchTag: 'fiduciary:matter-2#no_successor:trustee:client' })
    expect(planFiduciaryEmit(MATTER, [theirs], []).supersede).toEqual([])
  })

  /** A tag this module did not write is nobody's to retire. */
  it('never touches a task whose tag it cannot parse', () => {
    expect(planFiduciaryEmit(MATTER, [existing({ id: 'foreign', batchTag: 'something-else' })], []).supersede).toEqual([])
  })
})
