import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { GeneratedDatabase } from '@/types/supabase'
import { budgetExhausted, TICK_BUDGET_MS, workRun, type RunContext } from '@/lib/runs/worker'
import { makeFakeClient, type FakeClient } from './helpers/reviewFakeSupabase'
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
      // The run's own pinned instructions — `workRun` forwards this to the
      // engine so a retry renders what the run was answering against.
      render_version: 1,
      text_layer_id: null,
      document_version_id: null,
      model: null,
    },
    prompt: {
      versionId: 'v1',
      promptId: 'p1',
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

function asClient(client: FakeClient): SupabaseClient<GeneratedDatabase> {
  return client as unknown as SupabaseClient<GeneratedDatabase>
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

  /**
   * The one line joining a run's pinned instructions to the engine.
   *
   * `workRun` reads `run.render_version` and hands it to
   * `runFieldAudit`. With a single version in the registry, pinning 1 and
   * pinning null render identical text — so nothing about the rendered prompt
   * can tell them apart, and changing the worker to forward `null` passed all
   * 1131 tests. Two earlier attempts at this test were themselves vacuous:
   * one asserted on a fake that never reached the engine, the other built a
   * second hand-rolled client this file's own header warns against.
   *
   * This pins a version the registry does not have. The engine then throws
   * before spending a model call, the unit fails, and the reason names the
   * version it was given — which is only possible if the worker forwarded it.
   * Drop the forwarding and the unit succeeds instead.
   */
  it('forwards the run’s pinned render version to the engine', async () => {
    const client = makeClientWithSteps(1)
    const context = contextWith(1)
    const pinned = {
      ...context,
      run: { ...context.run, render_version: 7 },
    } as RunContext

    let called = false
    await expect(
      workRun(asClient(client), pinned, {
        callModel: async () => {
          called = true
          return reply()
        },
        now: () => 0,
      }),
    ).rejects.toThrow(/version 7/)

    // And no model call was spent finding out. The instructions are resolved
    // before the unit loop, so a version this build does not have fails the
    // whole run rather than each unit in turn with the same message — it is
    // not a per-unit problem, it is "this build cannot finish this run".
    expect(called).toBe(false)
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
