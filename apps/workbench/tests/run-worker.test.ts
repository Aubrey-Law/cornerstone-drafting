import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from '@/lib/supabase/database'
import { budgetExhausted, TICK_BUDGET_MS, workRun, type RunContext } from '@/lib/runs/worker'
import { makeFakeClient, type FakeClient } from './helpers/fakeSupabase'
import { FIELD_AUDIT_TOOL_NAME } from '@aubrey-law/citations/fieldAudit/runFieldAudit'
import type { ModelResponse } from '@aubrey-law/citations/review/model'
import type { FieldAuditBody, FieldAuditCheck } from '@aubrey-law/citations/prompt/body'

/**
 * The worker's own time budget, and the property the whole slice turns on:
 * a run too long for one invocation must be continuable, not lost.
 *
 * `makeFakeClient` (`./helpers/fakeSupabase`) is the same in-memory stand-in
 * `run-retry.test.ts` builds on — no second hand-rolled fake.
 */

const CHECKS: FieldAuditCheck[] = ['1', '2', '3', '4'].map((number) => ({
  number,
  statement: `Check ${number}.`,
  risk: 'high',
  reads: [],
  taskTemplate: { title: 'Task', description: 'Do the thing.', priority: 'high' },
}))

const BODY: FieldAuditBody = { kind: 'field_audit', inputs: [], checks: CHECKS, outputTarget: 'task_set' }

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

/** Advances by a fixed amount each time a caller asks it to, rather than the wall clock. */
function fakeClock() {
  let t = 0
  return {
    now: () => t,
    advance(ms: number) {
      t += ms
    },
  }
}

/** A run with `n` of `CHECKS`' units still `pending`, in sequence order. */
function makeClientWithSteps(n: number): FakeClient {
  return makeFakeClient({
    workflow_runs: [{ id: 'run-1', kind: 'field_audit', matter_id: 'm1', model: null }],
    workflow_run_steps: CHECKS.slice(0, n).map((check, index) => ({
      run_id: 'run-1',
      unit_id: check.number,
      status: 'pending',
      sequence: index,
      attempts: 0,
      finding_id: null,
    })),
    workflow_findings: [],
    workflow_field_references: [],
  })
}

/** What `workRun` needs to know about a run already known to exist — see `loadRunContext`. */
function contextWith(n: number): RunContext {
  return {
    ok: true,
    kind: 'field_audit',
    run: {
      id: 'run-1',
      kind: 'field_audit',
      prompt_version_id: 'v1',
      matter_id: 'm1',
      resolved_inputs: {},
      text_layer_id: null,
      document_version_id: null,
      model: null,
    },
    prompt: {
      versionId: 'v1',
      versionNumber: 1,
      slug: 'audit-1',
      title: 'Audit One',
      body: { ...BODY, checks: CHECKS.slice(0, n) },
    },
    values: {},
  }
}

/** The unit ids still `pending`, in sequence order — what a resumable run leaves behind. */
async function pendingSteps(client: FakeClient): Promise<string[]> {
  return (client.tableRows('workflow_run_steps') as Array<{ unit_id: string; status: string; sequence: number }>)
    .filter((row) => row.status === 'pending')
    .sort((a, b) => a.sequence - b.sequence)
    .map((row) => row.unit_id)
}

function asClient(client: FakeClient): SupabaseClient<WorkbenchDatabase> {
  return client as unknown as SupabaseClient<WorkbenchDatabase>
}

describe('the tick’s time budget', () => {
  it('stops well inside the invocation ceiling', () => {
    // maxDuration is 300s. Stopping at 240 leaves room for the unit in
    // flight to finish and for the run to be finalised — a worker killed at
    // the ceiling loses the unit it was mid-way through.
    expect(TICK_BUDGET_MS).toBeLessThanOrEqual(240_000)
    expect(TICK_BUDGET_MS).toBeGreaterThan(60_000)
  })

  it('is not exhausted at the start', () => {
    expect(budgetExhausted(0, 0)).toBe(false)
  })

  it('is exhausted once the budget has passed', () => {
    expect(budgetExhausted(0, TICK_BUDGET_MS + 1)).toBe(true)
  })

  it('stops before a unit that would not fit', () => {
    // A unit takes about ten seconds. Starting one with five seconds left
    // spends the money and loses the answer.
    expect(budgetExhausted(0, TICK_BUDGET_MS - 5_000)).toBe(true)
  })
})

describe('working a run', () => {
  it('leaves the units it did not reach pending, and the run resumable', async () => {
    // The property the whole slice turns on: a run too long for one
    // invocation must be continuable, not lost.
    const clock = fakeClock()
    const client = makeClientWithSteps(4)
    const result = await workRun(asClient(client), contextWith(4), {
      callModel: async () => {
        clock.advance(120_000)
        return reply()
      },
      now: clock.now,
    })
    expect(result.done).toBe(false)
    expect(result.worked).toBe(2)
    expect(await pendingSteps(client)).toEqual(['3', '4'])
  })

  it('is done once every step has settled', async () => {
    const client = makeClientWithSteps(2)
    const result = await workRun(asClient(client), contextWith(2), {
      callModel: async () => reply(),
      now: () => 0,
    })
    expect(result.done).toBe(true)
    expect(result.worked).toBe(2)
    expect(await pendingSteps(client)).toEqual([])
  })
})
