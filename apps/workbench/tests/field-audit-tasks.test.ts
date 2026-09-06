import { describe, expect, it } from 'vitest'
import {
  PROMPT_TASK_SOURCE,
  taskRowsFor,
  tasksToSupersede,
  tasksToSupersedeForUnits,
  type ExistingPromptTask,
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
  ...over,
})

describe('tasksToSupersede', () => {
  it('supersedes an open, unassigned task from an earlier run', () => {
    const ids = tasksToSupersede([existingTask({ id: 'task-1' })], 'run-new')
    expect(ids).toEqual(['task-1'])
  })

  /**
   * The moment someone picks a task up it stops being merely a suggestion
   * still standing. A newer run no longer surfacing the same finding does
   * not make that work moot, so a tool must never close it out from under
   * them.
   */
  it('never supersedes a task someone has been assigned', () => {
    const ids = tasksToSupersede([existingTask({ assigneeId: 'user-1' })], 'run-new')
    expect(ids).toEqual([])
  })

  /**
   * A completed task is a record of work that actually happened. Closing it
   * out as "superseded" would rewrite history rather than tidy a queue.
   */
  it('never supersedes a task that is already done', () => {
    const ids = tasksToSupersede([existingTask({ status: 'done' })], 'run-new')
    expect(ids).toEqual([])
  })

  it('never touches a task from another source', () => {
    const ids = tasksToSupersede([existingTask({ source: 'manual' })], 'run-new')
    expect(ids).toEqual([])
  })

  it('never supersedes this run’s own tasks', () => {
    const ids = tasksToSupersede([existingTask({ batchTag: 'prompt:run-new' })], 'run-new')
    expect(ids).toEqual([])
  })

  it('leaves a blocked or in-progress task alone too', () => {
    const ids = tasksToSupersede(
      [existingTask({ id: 'a', status: 'blocked' }), existingTask({ id: 'b', status: 'in_progress' })],
      'run-new',
    )
    expect(ids).toEqual([])
  })

  it('supersedes several eligible tasks from different earlier runs at once', () => {
    const ids = tasksToSupersede(
      [
        existingTask({ id: 'a', batchTag: 'prompt:run-1' }),
        existingTask({ id: 'b', batchTag: 'prompt:run-2' }),
        existingTask({ id: 'c', assigneeId: 'user-1' }),
      ],
      'run-3',
    )
    expect(ids.sort()).toEqual(['a', 'b'])
  })

  /**
   * A tag now carries a unit suffix (`prompt:run-old#3`), but this is still
   * a previous run's tag as far as a first run is concerned — the run id is
   * parsed back out rather than the whole tag compared, so the suffix
   * changes nothing about which earlier tasks get closed.
   */
  it('still selects a previous run’s tasks despite the new unit suffix', () => {
    const ids = tasksToSupersede([existingTask({ id: 'task-1', batchTag: 'prompt:run-old#3' })], 'run-new')
    expect(ids).toEqual(['task-1'])
  })

  it('still leaves this run’s own tasks alone once they carry a unit suffix', () => {
    const ids = tasksToSupersede([existingTask({ batchTag: 'prompt:run-new#3' })], 'run-new')
    expect(ids).toEqual([])
  })
})

describe('tasksToSupersedeForUnits', () => {
  it('supersedes only this run’s open, unassigned task for a named unit', () => {
    const ids = tasksToSupersedeForUnits(
      [existingTask({ id: 'task-1', batchTag: 'prompt:run-1#2' })],
      'run-1',
      ['2'],
    )
    expect(ids).toEqual(['task-1'])
  })

  /**
   * The whole reason this is a separate function from `tasksToSupersede`:
   * a retry only replaces the units it actually retried. A unit this retry
   * never touched keeps its earlier task, even though it came from the same
   * run.
   */
  it('never supersedes this run’s task for a unit outside the named set', () => {
    const ids = tasksToSupersedeForUnits(
      [existingTask({ id: 'task-1', batchTag: 'prompt:run-1#2' })],
      'run-1',
      ['3'],
    )
    expect(ids).toEqual([])
  })

  it('never supersedes another run’s task for the same unit number', () => {
    const ids = tasksToSupersedeForUnits(
      [existingTask({ id: 'task-1', batchTag: 'prompt:run-other#2' })],
      'run-1',
      ['2'],
    )
    expect(ids).toEqual([])
  })

  it('never supersedes an assigned task, even for a named unit of this run', () => {
    const ids = tasksToSupersedeForUnits(
      [existingTask({ id: 'task-1', batchTag: 'prompt:run-1#2', assigneeId: 'user-1' })],
      'run-1',
      ['2'],
    )
    expect(ids).toEqual([])
  })

  it('never supersedes a non-open task, even for a named unit of this run', () => {
    const ids = tasksToSupersedeForUnits(
      [existingTask({ id: 'task-1', batchTag: 'prompt:run-1#2', status: 'done' })],
      'run-1',
      ['2'],
    )
    expect(ids).toEqual([])
  })

  it('never touches a task from another source, even matching the run and unit', () => {
    const ids = tasksToSupersedeForUnits(
      [existingTask({ id: 'task-1', batchTag: 'prompt:run-1#2', source: 'manual' })],
      'run-1',
      ['2'],
    )
    expect(ids).toEqual([])
  })

  it('supersedes several named units from this run at once, leaving an untouched unit alone', () => {
    const ids = tasksToSupersedeForUnits(
      [
        existingTask({ id: 'a', batchTag: 'prompt:run-1#1' }),
        existingTask({ id: 'b', batchTag: 'prompt:run-1#2' }),
        existingTask({ id: 'c', batchTag: 'prompt:run-1#3' }),
      ],
      'run-1',
      ['1', '2'],
    )
    expect(ids.sort()).toEqual(['a', 'b'])
  })
})
