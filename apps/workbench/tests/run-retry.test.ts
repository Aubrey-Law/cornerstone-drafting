import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from '@/lib/supabase/database'
import { retryFailedSteps } from '@/lib/runs/retry'
import { makeFakeClient } from './helpers/fakeSupabase'
import { FIELD_AUDIT_TOOL_NAME } from '@aubrey-law/citations/fieldAudit/runFieldAudit'
import type { ModelRequest, ModelResponse } from '@aubrey-law/citations/review/model'
import type { FieldAuditBody, FieldAuditCheck } from '@aubrey-law/citations/prompt/body'

/**
 * Retrying a run — proving the property the whole slice exists for.
 *
 * `stubClientWithRun` builds on `makeFakeClient` (`./helpers/fakeSupabase`)
 * rather than a second hand-rolled fake: it seeds a `field_audit` run, its
 * steps, and the prompt version it was checked against, then wraps two
 * chains so the test can see what retry actually did that a seeded table
 * can't show by itself — which prompt version id got read, and which
 * finding ids got deleted.
 */

const AUDIT_CHECKS: FieldAuditCheck[] = ['1', '2', '3'].map((number) => ({
  number,
  statement: `Check ${number}.`,
  risk: 'high',
  reads: ['concerns'],
  taskTemplate: { title: 'Task', description: 'Do the thing.', priority: 'high' },
}))

const AUDIT_BODY: FieldAuditBody = {
  kind: 'field_audit',
  inputs: [{ key: 'concerns', source: 'design_sheet.concerns', required: false }],
  checks: AUDIT_CHECKS,
}

function unitOf(request: ModelRequest): string {
  const content = String((request.messages[0] as { content: unknown }).content)
  const match = content.match(/Check (\S+):/)
  if (!match) throw new Error(`Could not find a check number in the request: ${content}`)
  return match[1]
}

function sheetTextOf(request: ModelRequest): string {
  const system = request.system as Array<{ text: string }>
  // index 0 is the static instructions; index 1 is the cached, varying sheet.
  return system[1]?.text ?? ''
}

function reply(): ModelResponse {
  return {
    content: [
      {
        type: 'tool_use',
        name: FIELD_AUDIT_TOOL_NAME,
        id: 'x',
        input: { outcome: 'compliant', rationale: 'Fine.', references: [] },
      },
    ],
  } as unknown as ModelResponse
}

/**
 * A deviation whose one reference verifies against `resolved_inputs`'
 * default `concerns` value — an actionable finding, the kind
 * `actionableFindings` keeps and `emitTasks` turns into a task.
 */
function actionableReply(): ModelResponse {
  return {
    content: [
      {
        type: 'tool_use',
        name: FIELD_AUDIT_TOOL_NAME,
        id: 'x',
        input: {
          outcome: 'deviation',
          rationale: 'The concern is not addressed by the plan.',
          references: [{ field_key: 'concerns', claimed_value: 'the original words' }],
        },
      },
    ],
  } as unknown as ModelResponse
}

interface StepSeed {
  unit_id: string
  status: 'pending' | 'running' | 'succeeded' | 'failed'
  sequence: number
  finding_id?: string | null
}

interface StubConfig {
  steps: StepSeed[]
  resolved_inputs?: Record<string, unknown>
  prompt_version_id?: string
  findings?: Array<{ id: string; run_id: string; rule_number: string }>
  tasks?: Array<Record<string, unknown>>
}

/**
 * A field-audit run, seeded with its steps and its own pinned prompt
 * version — and, deliberately, a `design_sheets` row holding a *different*
 * value than `resolved_inputs`. That row is never read by a correct
 * `retryFailedSteps`: it exists so that the break/restore experiment (make
 * retry read the live sheet instead of the pinned column) has something
 * different to leak, rather than happening to pass either way.
 */
function stubClientWithRun(config: StubConfig) {
  const promptVersionId = config.prompt_version_id ?? 'v1'
  const base = makeFakeClient({
    workflow_runs: [
      {
        id: 'run-1',
        kind: 'field_audit',
        prompt_version_id: promptVersionId,
        matter_id: 'm1',
        resolved_inputs: config.resolved_inputs ?? { concerns: 'the original words' },
        text_layer_id: null,
        document_version_id: null,
        model: null,
      },
    ],
    workflow_run_steps: config.steps.map((step) => ({
      run_id: 'run-1',
      unit_id: step.unit_id,
      status: step.status,
      sequence: step.sequence,
      attempts: 1,
      finding_id: step.finding_id ?? null,
    })),
    workflow_findings: config.findings ?? [],
    prompts: [{ id: 'p1', slug: 'audit-1', title: 'Audit One', kind: 'field_audit' }],
    prompt_versions: [{ id: promptVersionId, version_number: 1, body: AUDIT_BODY, prompt_id: 'p1' }],
    matters: [{ id: 'm1', name: 'Test matter' }],
    design_sheets: [{ matter_id: 'm1', version: 1, concerns: 'edited since' }],
    tasks: config.tasks ?? [],
  })

  const deletedFindings: string[] = []
  const versionsRead: string[] = []

  return {
    tableRows: base.tableRows,
    deletedFindings,
    versionsRead,
    from(table: string) {
      const builder = base.from(table) as unknown as {
        eq: (column: string, value: unknown) => unknown
        delete: () => { eq: (column: string, value: unknown) => unknown }
      }
      if (table === 'prompt_versions') {
        const originalEq = builder.eq.bind(builder)
        builder.eq = (column: string, value: unknown) => {
          if (column === 'id') versionsRead.push(String(value))
          return originalEq(column, value)
        }
      }
      if (table === 'workflow_findings') {
        const originalDelete = builder.delete.bind(builder)
        builder.delete = () => {
          const del = originalDelete()
          const originalDelEq = del.eq.bind(del)
          del.eq = (column: string, value: unknown) => {
            if (column === 'id') deletedFindings.push(String(value))
            return originalDelEq(column, value)
          }
          return del
        }
      }
      return builder
    },
  }
}

function client(config: StubConfig) {
  return stubClientWithRun(config) as unknown as SupabaseClient<WorkbenchDatabase>
}

describe('retrying a run', () => {
  it('calls the model only for the units that failed', async () => {
    // The whole point. A run that lost one check of six must cost one call
    // to fix, not six — and the five that succeeded must not be re-paid for.
    const called: string[] = []
    await retryFailedSteps(
      client({
        steps: [
          { unit_id: '1', status: 'succeeded', sequence: 0 },
          { unit_id: '2', status: 'failed', sequence: 1 },
          { unit_id: '3', status: 'succeeded', sequence: 2 },
        ],
      }),
      'run-1',
      {
        callModel: async (request) => {
          called.push(unitOf(request))
          return reply()
        },
      },
    )
    expect(called).toEqual(['2'])
  })

  it('replays against the evidence the run was pinned to, not the sheet as it is now', async () => {
    // A retry an hour later must answer the same question the run asked. A
    // sheet edited in between belongs to a fresh run, not this one.
    let seen = ''
    await retryFailedSteps(
      client({
        resolved_inputs: { concerns: 'the original words' },
        steps: [{ unit_id: '1', status: 'failed', sequence: 0 }],
      }),
      'run-1',
      {
        callModel: async (request) => {
          seen = sheetTextOf(request)
          return reply()
        },
      },
    )
    expect(seen).toContain('the original words')
    expect(seen).not.toContain('edited since')
  })

  it('uses the prompt version the run used, not whatever is published now', async () => {
    // A retry finishes the run it belongs to. Silently upgrading it to a
    // newer wording would make the run's findings answers to two questions.
    const stub = stubClientWithRun({
      prompt_version_id: 'v1',
      steps: [{ unit_id: '1', status: 'failed', sequence: 0 }],
    })
    await retryFailedSteps(stub as unknown as SupabaseClient<WorkbenchDatabase>, 'run-1', {
      callModel: async () => reply(),
    })
    expect(stub.versionsRead).toEqual(['v1'])
  })

  it('does nothing when no step failed', async () => {
    let calls = 0
    const result = await retryFailedSteps(
      client({ steps: [{ unit_id: '1', status: 'succeeded', sequence: 0 }] }),
      'run-1',
      { callModel: async () => { calls += 1; return reply() } },
    )
    expect(calls).toBe(0)
    expect(result).toEqual({ ok: true, retried: 0 })
  })

  it('replaces the finding its earlier attempt left, and only that one', async () => {
    // workflow_findings has unique (run_id, rule_number), so a retried
    // unit's new finding collides with the one its earlier attempt left. The
    // old one is a superseded answer to the same question from the same
    // run — keeping both would make the constraint a lie. Another unit's
    // finding is untouched.
    const stub = stubClientWithRun({
      steps: [
        { unit_id: '1', status: 'succeeded', sequence: 0, finding_id: 'f1' },
        { unit_id: '2', status: 'failed', sequence: 1, finding_id: 'f2' },
      ],
      findings: [
        { id: 'f1', run_id: 'run-1', rule_number: '1' },
        { id: 'f2', run_id: 'run-1', rule_number: '2' },
      ],
    })
    await retryFailedSteps(stub as unknown as SupabaseClient<WorkbenchDatabase>, 'run-1', {
      callModel: async () => reply(),
    })
    expect(stub.deletedFindings).toEqual(['f2'])
  })

  it('deletes nothing when the retried step never produced a finding', async () => {
    // The only step being retried here has finding_id: null — a genuine
    // null, not an absent field a lenient check would let slide by.
    const stub = stubClientWithRun({
      steps: [{ unit_id: '1', status: 'failed', sequence: 0, finding_id: null }],
    })
    await retryFailedSteps(stub as unknown as SupabaseClient<WorkbenchDatabase>, 'run-1', {
      callModel: async () => reply(),
    })
    expect(stub.deletedFindings).toEqual([])
  })

  /**
   * The gap this commit closes: a check that failed, was retried, and now
   * reports a verified actionable finding must create the task a first run
   * would have given it. Before this, `retryFailedSteps` never called
   * `emitTasks` at all, so this finding showed on screen and created nothing.
   */
  it('a retry that turns a failure into a verified actionable finding creates the task for it', async () => {
    const stub = stubClientWithRun({
      steps: [
        { unit_id: '1', status: 'succeeded', sequence: 0 },
        { unit_id: '2', status: 'failed', sequence: 1 },
        { unit_id: '3', status: 'succeeded', sequence: 2 },
      ],
    })
    const result = await retryFailedSteps(stub as unknown as SupabaseClient<WorkbenchDatabase>, 'run-1', {
      callModel: async () => actionableReply(),
    })
    expect(result).toEqual({ ok: true, retried: 1 })

    const tasks = stub.tableRows('tasks')
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      matter_id: 'm1',
      source: 'prompt',
      // Tags both the run and the unit — the retried check, "2" — so a
      // later retry of a *different* unit in this same run never touches
      // this task by mistake.
      batch_tag: 'prompt:run-1#2',
      title: 'Task',
    })
  })

  /**
   * The other half of the same gap: a retry must supersede only the unit it
   * actually retried, never the tasks standing for units it left alone —
   * `tasksToSupersedeForUnits`, not the first-run `tasksToSupersede`.
   */
  it('supersedes only that unit’s earlier task, leaving other units’ tasks alone', async () => {
    const stub = stubClientWithRun({
      steps: [
        { unit_id: '1', status: 'succeeded', sequence: 0 },
        { unit_id: '2', status: 'failed', sequence: 1 },
        { unit_id: '3', status: 'succeeded', sequence: 2 },
      ],
      tasks: [
        {
          id: 'task-unit-2',
          matter_id: 'm1',
          source: 'prompt',
          task_type: 'single',
          auto: true,
          batch_tag: 'prompt:run-1#2',
          title: 'Old task for unit 2',
          description: 'Stale.',
          priority: 'high',
          status: 'open',
          assignee_id: null,
        },
        {
          id: 'task-unit-1',
          matter_id: 'm1',
          source: 'prompt',
          task_type: 'single',
          auto: true,
          batch_tag: 'prompt:run-1#1',
          title: 'Task for unit 1',
          description: 'Untouched by this retry.',
          priority: 'high',
          status: 'open',
          assignee_id: null,
        },
      ],
    })
    await retryFailedSteps(stub as unknown as SupabaseClient<WorkbenchDatabase>, 'run-1', {
      callModel: async () => actionableReply(),
    })

    const tasks = stub.tableRows('tasks')
    const byId = new Map(tasks.map((task) => [String(task.id), task]))

    // The old task for the retried unit is archived — this retry replaced it.
    expect(byId.get('task-unit-2')?.status).toBe('archived')
    // Unit 1 never failed and was never retried: its task is untouched.
    expect(byId.get('task-unit-1')?.status).toBe('open')
    // And the new task the retry itself just created is not immediately
    // superseded by its own insert — see emitTasks' read-before-insert order.
    // (The fake table applies no DB default, so the freshly-inserted row
    // carries no `status` at all rather than the real schema's `open`
    // default — what matters here is that it is not `archived`.)
    const newTaskForUnit2 = tasks.find((task) => task.id !== 'task-unit-2' && task.batch_tag === 'prompt:run-1#2')
    expect(newTaskForUnit2).toBeDefined()
    expect(newTaskForUnit2?.status).not.toBe('archived')
  })
})
