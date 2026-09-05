import { describe, expect, it } from 'vitest'
import { PROMPT_TASK_SOURCE, taskRowsFor, tasksToSupersede, type ExistingPromptTask } from '@/lib/fieldAudit/tasks'
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
        batch_tag: 'prompt:run-1',
        title: 'A stated concern is not answered by the plan',
        description:
          'The design sheet records a concern the structured decisions do not address.\n\n' +
          'The client raised a concern about the stepchildren that the residuary never answers.',
        priority: 'high',
      },
    ])
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
})
