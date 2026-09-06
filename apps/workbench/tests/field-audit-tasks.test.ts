import { describe, expect, it } from 'vitest'
import {
  PROMPT_TASK_SOURCE,
  emitTasks,
  planEmit,
  taskRowsFor,
  type ExistingPromptTask,
  type TaskRow,
} from '@/lib/fieldAudit/tasks'
import type { FieldAuditCheck } from '@aubrey-law/citations/prompt/body'
import type { FieldAuditFinding } from '@aubrey-law/citations/fieldAudit/types'
import { runAnswers, type RunAnswers } from '@aubrey-law/citations/fieldAudit/runFieldAudit'

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
    const rows = taskRowsFor('matter-1', 'run-1', [check()], [finding()], 'task_set', 'Audit')

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
        checklist: [],
      },
    ])
  })

  /**
   * A task records which run produced it *and* which check within that run —
   * without the unit half of the tag, a retry replacing one unit's task
   * would have no way to leave the rest of the run's tasks alone.
   */
  it('names both the run and the unit in the batch tag', () => {
    const [row] = taskRowsFor(
      'matter-1',
      'run-1',
      [check({ number: '7' })],
      [finding({ checkNumber: '7' })],
      'task_set',
      'Audit',
    )
    expect(row.batch_tag).toBe('prompt:run-1#7')
  })

  it('produces one row per finding', () => {
    const rows = taskRowsFor(
      'matter-1',
      'run-1',
      [check({ number: '1' }), check({ number: '2', taskTemplate: { title: 'Other', description: 'Other issue', priority: 'normal' } })],
      [finding({ checkNumber: '1' }), finding({ checkNumber: '2' })],
      'task_set',
      'Audit',
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
    const rows = taskRowsFor(
      'matter-1',
      'run-1',
      [check({ number: '1' })],
      [finding({ checkNumber: '9' })],
      'task_set',
      'Audit',
    )
    expect(rows).toEqual([])
  })

  it('produces no rows for no findings', () => {
    expect(taskRowsFor('matter-1', 'run-1', [check()], [], 'task_set', 'Audit')).toEqual([])
  })
})

const CHECK_2 = check({
  number: '2',
  taskTemplate: {
    title: 'A person named in the notes is missing from the plan',
    description: 'Someone is named in free text but appears in no structured field.',
    priority: 'normal',
  },
})
/**
 * Check 2 first, deliberately. Declared in numeric order, body order and
 * check-number order coincide — and the ordering test below could then not
 * tell a body-order sort from a sort on `checkNumber`, which would pass today
 * and diverge the moment a prompt declares its checks out of order, or reaches
 * check 10, which sorts before check 2 as a string.
 */
const CHECKS = [CHECK_2, check({ number: '1' })]

const FINDING_1 = finding({ checkNumber: '1', rationale: 'Because the residuary never answers it.' })
const FINDING_2 = finding({ checkNumber: '2', rationale: 'And nobody named Ruth appears anywhere.' })

/**
 * Read off the fixture rather than typed out, because it has to be the exact
 * string `taskRowsFor` puts in a checklist item. A hand-typed near-miss would
 * make the run-level superset clause in `mayRetire` be tested against text it
 * can never match, and the test would then pass for the wrong reason.
 */
const CHECK_1_TITLE = check({ number: '1' }).taskTemplate.title

describe('taskRowsFor with an output target', () => {
  it('produces no rows at all for chat', () => {
    expect(taskRowsFor('matter-1', 'run-1', CHECKS, [FINDING_1], 'chat', 'Audit')).toEqual([])
  })

  it('produces one single task per finding for task_set', () => {
    const rows = taskRowsFor('matter-1', 'run-1', CHECKS, [FINDING_1, FINDING_2], 'task_set', 'Audit')
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.task_type)).toEqual(['single', 'single'])
    // Body order, which `CHECKS` deliberately declares check 2 first in.
    expect(rows.map((row) => row.batch_tag)).toEqual(['prompt:run-1#2', 'prompt:run-1#1'])
    expect(rows.every((row) => row.checklist.length === 0)).toBe(true)
  })

  it('produces exactly one checklist task carrying an item per finding', () => {
    const rows = taskRowsFor('matter-1', 'run-1', CHECKS, [FINDING_1, FINDING_2], 'checklist', 'MA design sheet audit')
    expect(rows).toHaveLength(1)
    expect(rows[0].task_type).toBe('checklist')
    // No unit suffix: there is no single unit a run-level task belongs to.
    expect(rows[0].batch_tag).toBe('prompt:run-1')
    expect(rows[0].title).toBe('MA design sheet audit')
    expect(rows[0].checklist).toEqual([
      { text: 'A person named in the notes is missing from the plan', done: false },
      { text: 'A stated concern is not answered by the plan', done: false },
    ])
    // Collapsing into items must not lose the evidence.
    expect(rows[0].description).toContain('Because the residuary never answers it.')
    expect(rows[0].description).toContain('And nobody named Ruth appears anywhere.')
  })

  /**
   * The body's order, not the findings' arrival order. A prompt's checks are
   * ordered the way their author meant, and a checklist read out of that
   * order reads as a different document.
   */
  it('orders items by the prompt body, not by the findings array or the check number', () => {
    // The findings arrive in numeric order, and `CHECKS` declares check 2
    // first, so only a body-order sort produces this. A sort on
    // `finding.checkNumber` would put check 1's item first and fail here.
    const rows = taskRowsFor('matter-1', 'run-1', CHECKS, [FINDING_1, FINDING_2], 'checklist', 'Audit')
    expect(rows[0].checklist.map((item) => item.text)).toEqual([
      'A person named in the notes is missing from the plan',
      'A stated concern is not answered by the plan',
    ])
  })

  it('takes the highest priority among the contributing checks', () => {
    // Check 2 alone is 'normal'; with check 1's 'high' in the set it is 'high'.
    expect(taskRowsFor('matter-1', 'run-1', CHECKS, [FINDING_2], 'checklist', 'Audit')[0].priority).toBe('normal')
    expect(taskRowsFor('matter-1', 'run-1', CHECKS, [FINDING_1, FINDING_2], 'checklist', 'Audit')[0].priority).toBe('high')
  })

  /**
   * Not an empty checklist. A task with no items says work is needed and then
   * names none, which is worse than saying nothing — and it is exactly what a
   * run whose every finding failed verification would otherwise produce.
   */
  it('produces no checklist task when nothing is actionable', () => {
    expect(taskRowsFor('matter-1', 'run-1', CHECKS, [], 'checklist', 'Audit')).toEqual([])
  })

  it('skips a finding whose check the prompt version does not contain', () => {
    const drifted = finding({ checkNumber: '99', rationale: 'Out of step.' })
    expect(taskRowsFor('matter-1', 'run-1', CHECKS, [drifted], 'checklist', 'Audit')).toEqual([])
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
  /** A run that answered everything, so retirement is permitted and the
   *  existing guarantees below are unchanged by this slice. */
  function authoritative(): RunAnswers {
    return { byCheck: { '1': 'actionable' }, authoritative: true }
  }

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
    const plan = planEmit([open({ id: 'old-1', batchTag: 'prompt:run-old#1' })], [desiredRow()], authoritative())
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
    const plan = planEmit([open()], [desiredRow()], authoritative())
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
      authoritative(),
    )
    // Unit 1 is untouched: same id, same created_at, no churn.
    expect(plan.keep).toEqual(['unit-1'])
    expect(plan.supersede).toEqual(['unit-2'])
    expect(plan.insert.map((row) => row.batch_tag)).toEqual(['prompt:run-new#2'])
  })

  it('withdraws a task for a finding this run no longer makes', () => {
    const plan = planEmit([open({ id: 'gone', batchTag: 'prompt:run-new#9' })], [], authoritative())
    expect(plan.insert).toEqual([])
    expect(plan.keep).toEqual([])
    expect(plan.supersede).toEqual(['gone'])
  })

  /** A duplicate pair left by the pre-fix bug has only one twin to match. */
  it('self-heals a duplicate left by the earlier bug', () => {
    const plan = planEmit([open({ id: 'first' }), open({ id: 'second' })], [desiredRow()], authoritative())
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
      authoritative(),
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
    expect(planEmit([same], [row], authoritative())).toEqual({ insert: [], keep: ['list'], supersede: [] })

    const changed = existingTask({
      id: 'list',
      batchTag: 'prompt:run-new',
      taskType: 'checklist',
      checklist: [{ text: 'Two', done: false }],
    })
    const plan = planEmit([changed], [row], authoritative())
    expect(plan.keep).toEqual([])
    expect(plan.supersede).toEqual(['list'])
    expect(plan.insert).toHaveLength(1)
  })

  /**
   * A ticked item is someone's progress. `planEmit` only inserts and archives,
   * so "not matching" means archived-and-replaced-with-a-blank-copy, never
   * rewritten in place — which is why `done` is outside the content key.
   */
  it('keeps a checklist someone has partly ticked, so their progress survives', () => {
    const row = desiredRow({
      batch_tag: 'prompt:run-new',
      task_type: 'checklist',
      checklist: [
        { text: 'One', done: false },
        { text: 'Two', done: false },
      ],
    })
    const ticked = existingTask({
      id: 'list',
      batchTag: 'prompt:run-new',
      taskType: 'checklist',
      checklist: [
        { text: 'One', done: true },
        { text: 'Two', done: false },
      ],
    })
    expect(planEmit([ticked], [row], authoritative())).toEqual({ insert: [], keep: ['list'], supersede: [] })
  })

  /** But a checklist whose *items* changed is a different checklist. */
  it('replaces a checklist whose item text changed, ticks or not', () => {
    const row = desiredRow({
      batch_tag: 'prompt:run-new',
      task_type: 'checklist',
      checklist: [{ text: 'One', done: false }],
    })
    const ticked = existingTask({
      id: 'list',
      batchTag: 'prompt:run-new',
      taskType: 'checklist',
      checklist: [{ text: 'Something else', done: true }],
    })
    const plan = planEmit([ticked], [row], authoritative())
    expect(plan.keep).toEqual([])
    expect(plan.supersede).toEqual(['list'])
    expect(plan.insert).toHaveLength(1)
  })

  /** `priority` alone, because it is a *derived* value — the highest among the
   *  contributing checks — which is the kind of field a later refactor gets
   *  wrong without anything failing. */
  it('replaces a task whose priority alone changed', () => {
    const plan = planEmit([open({ priority: 'normal' })], [desiredRow()], authoritative())
    expect(plan.keep).toEqual([])
    expect(plan.supersede).toEqual(['task-1'])
    expect(plan.insert).toHaveLength(1)
  })

  /** The mirror of the self-heal case: one existing row against two identical
   *  desired rows must keep it once and insert the second, which is where an
   *  off-by-one in `matched` would show. */
  it('claims each twin at most once when two desired rows are identical', () => {
    const plan = planEmit([open({ id: 'only' })], [desiredRow(), desiredRow()], authoritative())
    expect(plan.keep).toEqual(['only'])
    expect(plan.insert).toHaveLength(1)
    expect(plan.supersede).toEqual([])
  })
})

describe('planEmit retirement scoping', () => {
  function checklistTask(over: Partial<ExistingPromptTask> = {}): ExistingPromptTask {
    return existingTask({
      id: 'list',
      batchTag: 'prompt:run-old',
      taskType: 'checklist',
      title: 'MA design sheet audit',
      description: 'One item to confirm.',
      checklist: [{ text: 'A stated concern is not answered by the plan', done: false }],
      ...over,
    })
  }

  function checklistRow(items: string[], over: Partial<TaskRow> = {}): TaskRow {
    return {
      matter_id: 'matter-1',
      source: PROMPT_TASK_SOURCE,
      task_type: 'checklist',
      auto: true,
      batch_tag: 'prompt:run-new',
      title: 'MA design sheet audit',
      description: 'Some items to confirm.',
      priority: 'high',
      checklist: items.map((text) => ({ text, done: false })),
      ...over,
    }
  }

  /**
   * The measured failure, replayed. Run `a2a4f300` produced a blocker with
   * four verified references and one checklist task; run `1c22acb5` reached
   * the same conclusion with zero references, so the gate refused it — and the
   * withdrawal step archived the first task anyway, leaving the matter with no
   * blocker at all. The task must now stand.
   */
  it('does not retire a task when the run could not cite the problem', () => {
    const plan = planEmit([checklistTask()], [], runAnswers({
      checkNumbers: ['1', '2'],
      findings: [],
      failedCheckNumbers: [],
    }))
    expect(plan.insert).toEqual([])
    expect(plan.keep).toEqual([])
    expect(plan.supersede).toEqual([])
  })

  /** The reverse: a run that answered everything and found nothing wrong. */
  it('retires the task when the run cleared every check', () => {
    const answers: RunAnswers = { byCheck: { '1': 'cleared', '2': 'cleared' }, authoritative: true }
    const plan = planEmit([checklistTask()], [], answers)
    expect(plan.supersede).toEqual(['list'])
  })

  /**
   * A run still reporting the same check says everything the old task said —
   * item text is the check's template title, fixed by the prompt version — so
   * the old one goes rather than standing beside the new one. Without this the
   * conservative rule would leave two checklists on the matter.
   */
  it('retires an older checklist whose items the new one repeats, even when inconclusive elsewhere', () => {
    const answers: RunAnswers = { byCheck: { '1': 'actionable', '3': 'inconclusive' }, authoritative: false }
    const plan = planEmit(
      [checklistTask()],
      [checklistRow(['A stated concern is not answered by the plan'])],
      answers,
    )
    expect(plan.supersede).toEqual(['list'])
    expect(plan.insert).toHaveLength(1)
  })

  it('keeps an older checklist that says something the new one does not', () => {
    const answers: RunAnswers = { byCheck: { '1': 'inconclusive' }, authoritative: false }
    const plan = planEmit(
      [checklistTask({ checklist: [
        { text: 'A stated concern is not answered by the plan', done: false },
        { text: 'A person named in the notes is missing from the plan', done: false },
      ] })],
      [checklistRow(['A stated concern is not answered by the plan'])],
      answers,
    )
    expect(plan.supersede).toEqual([])
    expect(plan.insert).toHaveLength(1)
  })

  /**
   * Clause 0. A retry rewrites its own answer under the same tag — it is not
   * retiring anything on the strength of silence — and this is the only thing
   * stopping it inserting a second task beside the one it replaces while the
   * run is inconclusive elsewhere.
   */
  it('replaces its own task by exact tag even when not authoritative', () => {
    const answers: RunAnswers = { byCheck: { '1': 'actionable', '2': 'inconclusive' }, authoritative: false }
    const plan = planEmit(
      [checklistTask({ id: 'mine', batchTag: 'prompt:run-new', description: 'Older wording.' })],
      [checklistRow(['A stated concern is not answered by the plan'])],
      answers,
    )
    expect(plan.supersede).toEqual(['mine'])
    expect(plan.insert).toHaveLength(1)
    expect(plan.keep).toEqual([])
  })

  it('replaces its own unit-tagged task by exact tag even when not authoritative', () => {
    const answers: RunAnswers = { byCheck: { '1': 'actionable' }, authoritative: false }
    const mine = existingTask({ id: 'unit', batchTag: 'prompt:run-new#1', description: 'Older wording.' })
    const row: TaskRow = {
      matter_id: 'matter-1', source: PROMPT_TASK_SOURCE, task_type: 'single', auto: true,
      batch_tag: 'prompt:run-new#1', title: 'A stated concern is not answered by the plan',
      description: 'Newer wording.', priority: 'high', checklist: [],
    }
    const plan = planEmit([mine], [row], answers)
    expect(plan.supersede).toEqual(['unit'])
    expect(plan.insert).toHaveLength(1)
  })

  describe('unit-suffixed tags', () => {
    const oldUnit = () => existingTask({ id: 'u7', batchTag: 'prompt:run-old#7' })

    it('retires it when this run cleared that check', () => {
      const answers: RunAnswers = { byCheck: { '7': 'cleared' }, authoritative: false }
      expect(planEmit([oldUnit()], [], answers).supersede).toEqual(['u7'])
    })

    it('keeps it when this run was inconclusive on that check', () => {
      const answers: RunAnswers = { byCheck: { '7': 'inconclusive' }, authoritative: false }
      expect(planEmit([oldUnit()], [], answers).supersede).toEqual([])
    })

    it('retires it when this run re-reports the same check under a new run id', () => {
      const answers: RunAnswers = { byCheck: { '7': 'actionable' }, authoritative: false }
      const row: TaskRow = {
        matter_id: 'matter-1', source: PROMPT_TASK_SOURCE, task_type: 'single', auto: true,
        batch_tag: 'prompt:run-new#7', title: 'Something', description: 'Anything',
        priority: 'high', checklist: [],
      }
      expect(planEmit([oldUnit()], [row], answers).supersede).toEqual(['u7'])
    })
  })

  /**
   * A tag with no unit suffix and no items carries no per-check signal at all,
   * so it stands unless the run is a complete answer or replacing it outright.
   * Fails safe rather than falling back to the old behaviour.
   */
  it('keeps a suffix-less task with no items unless the run is authoritative', () => {
    const legacy = existingTask({ id: 'legacy', batchTag: 'prompt:run-old', checklist: [] })
    const answers: RunAnswers = { byCheck: { '1': 'inconclusive' }, authoritative: false }
    expect(planEmit([legacy], [], answers).supersede).toEqual([])
    expect(planEmit([legacy], [], { byCheck: { '1': 'cleared' }, authoritative: true }).supersede).toEqual(['legacy'])
  })

  /** A tag this module did not write is never this run's to retire. */
  it('never retires a task whose tag it cannot parse', () => {
    const foreign = existingTask({ id: 'foreign', batchTag: 'something-else' })
    expect(planEmit([foreign], [], { byCheck: {}, authoritative: true }).supersede).toEqual([])
  })
})

/**
 * Enough of a PostgREST client for `emitTasks`: a `select` chain that resolves
 * to `rows`, plus recorders for what was inserted and updated.
 */
function fakeClient(rows: unknown[]) {
  const inserted: unknown[][] = []
  const updatedIds: string[][] = []
  const client = {
    from() {
      return {
        select() {
          return {
            eq() {
              return { eq: async () => ({ data: rows, error: null }) }
            },
          }
        },
        async insert(values: unknown[]) {
          inserted.push(values)
          return { error: null }
        },
        update() {
          return {
            async in(_column: string, ids: string[]) {
              updatedIds.push(ids)
              return { error: null }
            },
          }
        },
      }
    },
  }
  return { client: client as never, inserted, updatedIds }
}

describe('emitTasks', () => {
  /**
   * Not "produces no rows" — touches the database not at all. An empty
   * `desired` set reaching `planEmit` would withdraw every open prompt task on
   * the matter, so a `chat` prompt would silently destroy another prompt's
   * output. The short-circuit has to be before the query, and this is what
   * proves it is.
   */
  it('reads nothing and writes nothing for chat', async () => {
    let touched = false
    const client = {
      from() {
        touched = true
        throw new Error('emitTasks must not touch the database for a chat prompt')
      },
    } as never

    await expect(
      emitTasks(client, {
        matterId: 'matter-1',
        runId: 'run-1',
        checks: CHECKS,
        findings: [FINDING_1],
        failedCheckNumbers: [],
        outputTarget: 'chat',
        promptTitle: 'Audit',
      }),
    ).resolves.toEqual({ created: 0, kept: 0, superseded: 0 })
    expect(touched).toBe(false)
  })

  it('inserts one checklist row and withdraws the previous run’s tasks', async () => {
    const { client, inserted, updatedIds } = fakeClient([
      {
        id: 'old-1',
        source: PROMPT_TASK_SOURCE,
        batch_tag: 'prompt:run-old#1',
        status: 'open',
        assignee_id: null,
        title: 'A stated concern is not answered by the plan',
        description: 'Older wording.',
        priority: 'high',
        task_type: 'single',
        checklist: [],
      },
    ])

    const result = await emitTasks(client, {
      matterId: 'matter-1',
      runId: 'run-1',
      checks: CHECKS,
      findings: [FINDING_1, FINDING_2],
      failedCheckNumbers: [],
      outputTarget: 'checklist',
      promptTitle: 'MA design sheet audit',
    })

    expect(result).toEqual({ created: 1, kept: 0, superseded: 1 })
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toHaveLength(1)
    expect(updatedIds).toEqual([['old-1']])
  })

  /** The regression, end to end through `emitTasks` rather than `planEmit`. */
  it('is idempotent: a second pass over the same run writes nothing', async () => {
    const first = fakeClient([])
    await emitTasks(first.client, {
      matterId: 'matter-1',
      runId: 'run-1',
      checks: CHECKS,
      findings: [FINDING_1, FINDING_2],
      failedCheckNumbers: [],
      outputTarget: 'checklist',
      promptTitle: 'MA design sheet audit',
    })
    const row = (first.inserted[0] as Array<Record<string, unknown>>)[0]

    // The same row read back the way PostgREST would return it.
    const second = fakeClient([
      {
        id: 'list-1',
        source: row.source,
        batch_tag: row.batch_tag,
        status: 'open',
        assignee_id: null,
        title: row.title,
        description: row.description,
        priority: row.priority,
        task_type: row.task_type,
        checklist: row.checklist,
      },
    ])

    const result = await emitTasks(second.client, {
      matterId: 'matter-1',
      runId: 'run-1',
      checks: CHECKS,
      findings: [FINDING_1, FINDING_2],
      failedCheckNumbers: [],
      outputTarget: 'checklist',
      promptTitle: 'MA design sheet audit',
    })

    expect(result).toEqual({ created: 0, kept: 1, superseded: 0 })
    expect(second.inserted).toEqual([])
    expect(second.updatedIds).toEqual([])
  })

  /**
   * The end-to-end shape of the bug. `emitTasks` is handed a blocker with no
   * verified reference — which is what the model actually returned on the
   * second real run — and must create nothing *and* withdraw nothing.
   */
  it('creates nothing and withdraws nothing from an uncitable finding', async () => {
    const { client, inserted, updatedIds } = fakeClient([
      {
        id: 'standing',
        source: PROMPT_TASK_SOURCE,
        batch_tag: 'prompt:run-old',
        status: 'open',
        assignee_id: null,
        title: 'MA design sheet audit',
        description: 'One item to confirm.',
        priority: 'high',
        task_type: 'checklist',
        checklist: [{ text: CHECK_1_TITLE, done: false }],
      },
    ])

    const result = await emitTasks(client, {
      matterId: 'matter-1',
      runId: 'run-new',
      checks: CHECKS,
      findings: [finding({ checkNumber: '1', references: [] })],
      failedCheckNumbers: [],
      outputTarget: 'checklist',
      promptTitle: 'MA design sheet audit',
    })

    expect(result).toEqual({ created: 0, kept: 0, superseded: 0 })
    expect(inserted).toEqual([])
    expect(updatedIds).toEqual([])
  })

  it('applies the gate itself, so a compliant finding makes no task', async () => {
    const { client, inserted } = fakeClient([])
    const result = await emitTasks(client, {
      matterId: 'matter-1',
      runId: 'run-new',
      checks: CHECKS,
      findings: [finding({ checkNumber: '1', outcome: 'compliant' }), finding({ checkNumber: '2', outcome: 'compliant' })],
      failedCheckNumbers: [],
      outputTarget: 'checklist',
      promptTitle: 'MA design sheet audit',
    })
    expect(result.created).toBe(0)
    expect(inserted).toEqual([])
  })
})
