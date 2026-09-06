import { describe, expect, it } from 'vitest'
import {
  PROMPT_TASK_SOURCE,
  planEmit,
  taskRowsFor,
  type ExistingPromptTask,
  type TaskRow,
} from '@/lib/fieldAudit/tasks'
import type { FieldAuditCheck } from '@aubrey-law/citations/prompt/body'
import type { FieldAuditFinding } from '@aubrey-law/citations/fieldAudit/types'

const check = (over: Partial<FieldAuditCheck> = {}): FieldAuditCheck => ({
  number: '1',
  statement: 'Every concern is answered somewhere in the plan.',
  risk: 'blocker',
  reads: ['concerns'],
  taskTemplate: {
    title: 'A stated concern is not answered by the plan',
    description: 'The design sheet records a concern the structured decisions do not address.',
    priority: 'high',
  },
  ...over,
})

const finding = (over: Partial<FieldAuditFinding> = {}): FieldAuditFinding => ({
  checkNumber: '1',
  outcome: 'deviation',
  severity: 'high',
  rationale: 'The client raised a concern about the stepchildren that the residuary never answers.',
  references: [
    {
      fieldKey: 'concerns',
      claimedValue: 'worried about the stepchildren',
      actualValue: 'worried about the stepchildren',
      matchedPath: null,
      verification: 'verified',
    },
  ],
  ...over,
})

describe('taskRowsFor', () => {
  it('templates a task from the check and appends the finding’s rationale', () => {
    const rows = taskRowsFor('matter-1', 'run-1', [check()], [finding()])

    expect(rows).toEqual([
      {
        matter_id: 'matter-1',
        source: PROMPT_TASK_SOURCE,
        task_type: 'single',
        auto: true,
        batch_tag: 'prompt:run-1#1',
        title: 'A stated concern is not answered by the plan',
        description:
          'The design sheet records a concern the structured decisions do not address.\n\n' +
          'The client raised a concern about the stepchildren that the residuary never answers.',
        priority: 'high',
      },
    ])
  })

  /**
   * A task records which run produced it *and* which check within that run —
   * without the unit half of the tag, a retry replacing one unit's task
   * would have no way to leave the rest of the run's tasks alone.
   */
  it('names both the run and the unit in the batch tag', () => {
    const [row] = taskRowsFor('matter-1', 'run-1', [check({ number: '7' })], [finding({ checkNumber: '7' })])
    expect(row.batch_tag).toBe('prompt:run-1#7')
  })

  it('produces one row per finding', () => {
    const rows = taskRowsFor(
      'matter-1',
      'run-1',
      [check({ number: '1' }), check({ number: '2', taskTemplate: { title: 'Other', description: 'Other issue', priority: 'normal' } })],
      [finding({ checkNumber: '1' }), finding({ checkNumber: '2' })],
    )
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.title)).toEqual(['A stated concern is not answered by the plan', 'Other'])
    expect(rows.map((r) => r.batch_tag)).toEqual(['prompt:run-1#1', 'prompt:run-1#2'])
  })

  /**
   * A finding naming a check number the prompt no longer has is a sign the
   * prompt and the result have fallen out of step, not something to guess a
   * title for.
   */
  it('skips a finding whose check number matches no check', () => {
    const rows = taskRowsFor('matter-1', 'run-1', [check({ number: '1' })], [finding({ checkNumber: '9' })])
    expect(rows).toEqual([])
  })

  it('produces no rows for no findings', () => {
    expect(taskRowsFor('matter-1', 'run-1', [check()], [])).toEqual([])
  })
})

const existingTask = (over: Partial<ExistingPromptTask> = {}): ExistingPromptTask => ({
  id: 'task-1',
  source: PROMPT_TASK_SOURCE,
  batchTag: 'prompt:run-old',
  status: 'open',
  assigneeId: null,
  title: 'A stated concern is not answered by the plan',
  description: 'Whatever it said last time.',
  priority: 'high',
  taskType: 'single',
  checklist: [],
  ...over,
})

describe('planEmit', () => {
  /** A row this run wants to exist, matching `existingTask`'s content. */
  function desiredRow(overrides: Partial<TaskRow> = {}): TaskRow {
    return {
      matter_id: 'matter-1',
      source: PROMPT_TASK_SOURCE,
      task_type: 'single',
      auto: true,
      batch_tag: 'prompt:run-new#1',
      title: 'A stated concern is not answered by the plan',
      description: 'Whatever it said last time.',
      priority: 'high',
      checklist: [],
      ...overrides,
    }
  }

  /** One of this run's own open, unassigned tasks. */
  function open(overrides: Partial<ExistingPromptTask> = {}): ExistingPromptTask {
    return existingTask({ batchTag: 'prompt:run-new#1', ...overrides })
  }

  it('inserts everything and withdraws a previous run’s set on a first run', () => {
    const plan = planEmit([open({ id: 'old-1', batchTag: 'prompt:run-old#1' })], [desiredRow()])
    expect(plan.insert).toHaveLength(1)
    expect(plan.keep).toEqual([])
    expect(plan.supersede).toEqual(['old-1'])
  })

  /**
   * The regression this function exists to fix. #412 stopped passing
   * `unitIds`, so a retried run's second done-pass re-inserted a task for
   * every unit — including the ones that never failed, whose task survived
   * because the old filter excluded this run's own id. Nothing in the
   * database stops it: `tasks` has no unique index on `batch_tag`.
   */
  it('inserts nothing and withdraws nothing when the run already said this', () => {
    const plan = planEmit([open()], [desiredRow()])
    expect(plan.insert).toEqual([])
    expect(plan.keep).toEqual(['task-1'])
    expect(plan.supersede).toEqual([])
  })

  it('replaces a task whose rationale changed, and only that one', () => {
    const plan = planEmit(
      [
        open({ id: 'unit-1', batchTag: 'prompt:run-new#1' }),
        open({ id: 'unit-2', batchTag: 'prompt:run-new#2', title: 'A person is missing' }),
      ],
      [
        desiredRow({ batch_tag: 'prompt:run-new#1' }),
        desiredRow({
          batch_tag: 'prompt:run-new#2',
          title: 'A person is missing',
          description: 'Now it says something else.',
        }),
      ],
    )
    // Unit 1 is untouched: same id, same created_at, no churn.
    expect(plan.keep).toEqual(['unit-1'])
    expect(plan.supersede).toEqual(['unit-2'])
    expect(plan.insert.map((row) => row.batch_tag)).toEqual(['prompt:run-new#2'])
  })

  it('withdraws a task for a finding this run no longer makes', () => {
    const plan = planEmit([open({ id: 'gone', batchTag: 'prompt:run-new#9' })], [])
    expect(plan.insert).toEqual([])
    expect(plan.keep).toEqual([])
    expect(plan.supersede).toEqual(['gone'])
  })

  /** A duplicate pair left by the pre-fix bug has only one twin to match. */
  it('self-heals a duplicate left by the earlier bug', () => {
    const plan = planEmit([open({ id: 'first' }), open({ id: 'second' })], [desiredRow()])
    expect(plan.insert).toEqual([])
    expect(plan.keep).toEqual(['first'])
    expect(plan.supersede).toEqual(['second'])
  })

  it('never touches a task someone else made, holds, or has moved on', () => {
    const plan = planEmit(
      [
        existingTask({ id: 'manual', source: 'manual', batchTag: null }),
        existingTask({ id: 'assigned', batchTag: 'prompt:run-old#1', assigneeId: 'user-1' }),
        existingTask({ id: 'done', batchTag: 'prompt:run-old#2', status: 'done' }),
        existingTask({ id: 'in-progress', batchTag: 'prompt:run-old#3', status: 'in_progress' }),
      ],
      [desiredRow()],
    )
    expect(plan.supersede).toEqual([])
    expect(plan.insert).toHaveLength(1)
  })

  /** The checklist tag has no unit suffix and needs no special case. */
  it('treats a run-level tag exactly like a unit-level one', () => {
    const row = desiredRow({
      batch_tag: 'prompt:run-new',
      task_type: 'checklist',
      checklist: [{ text: 'One', done: false }],
    })
    const same = existingTask({
      id: 'list',
      batchTag: 'prompt:run-new',
      taskType: 'checklist',
      checklist: [{ text: 'One', done: false }],
    })
    expect(planEmit([same], [row])).toEqual({ insert: [], keep: ['list'], supersede: [] })

    const changed = existingTask({
      id: 'list',
      batchTag: 'prompt:run-new',
      taskType: 'checklist',
      checklist: [{ text: 'Two', done: false }],
    })
    const plan = planEmit([changed], [row])
    expect(plan.keep).toEqual([])
    expect(plan.supersede).toEqual(['list'])
    expect(plan.insert).toHaveLength(1)
  })

  /** A ticked item is progress, not a stale suggestion to overwrite. */
  it('withdraws rather than silently rewrites a checklist someone has ticked', () => {
    const row = desiredRow({
      batch_tag: 'prompt:run-new',
      task_type: 'checklist',
      checklist: [{ text: 'One', done: false }],
    })
    const ticked = existingTask({
      id: 'list',
      batchTag: 'prompt:run-new',
      taskType: 'checklist',
      checklist: [{ text: 'One', done: true }],
    })
    const plan = planEmit([ticked], [row])
    expect(plan.supersede).toEqual(['list'])
    expect(plan.insert).toHaveLength(1)
  })
})
