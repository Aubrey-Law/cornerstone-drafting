import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/cron/tick/route'
import type { EmitTasksInput } from '@/lib/fieldAudit/tasks'
import type { FiduciarySweepResult } from '@/lib/fiduciary/sweep'
import type { IdentitySweepResult } from '@/lib/identity/sweep'
import type { FieldAuditFinding } from '@aubrey-law/citations/fieldAudit/types'

/**
 * The tick route's door — the three outcomes that matter before any run is
 * ever touched: no secret configured, the wrong secret, and the cron's own.
 *
 * Every other module the route calls is stubbed, so the "accepts" case does
 * no real work — no database, no model call. That is deliberate: those tests
 * are only about the door. `claim_workflow_run` reports nothing queued by
 * default (a full row of nulls, matching what the live database actually
 * returns — see the route's own comment on `claimed?.id == null`), so the
 * accepted request short-circuits before `workRun`, `loadRunContext` or the
 * model caller do anything.
 *
 * The second suite below drives the same stubs the other way, so the route
 * runs all the way through to `emitTasks`.
 *
 * `callOrder` and `state` are shared between the stubs and the tests via
 * `vi.hoisted` — a mock factory cannot otherwise see a module-scope variable,
 * since `vi.mock` calls are hoisted above it. `callOrder` is what lets the
 * door test that cares about ordering tell "claimed before materialising"
 * apart from the reverse, which no assertion on the response body alone can
 * do: both stubs return fixed values regardless of when they were called.
 */

const callOrder = vi.hoisted(() => [] as string[])

/**
 * A sweep that considered nothing — the default, and what every test here but
 * the sweep suite's own expects in the payload. Hoisted because `state`'s own
 * factory reads it, and `vi.hoisted` factories run in source order.
 */
const SWEPT_NOTHING = vi.hoisted(() => ({
  mattersConsidered: 0,
  created: 0,
  kept: 0,
  superseded: 0,
  skipped: 0,
}))

/**
 * The same for the name check, which has no `skipped` — every matter it loads
 * is one it can compare, so there is no third outcome to count.
 */
const NAMES_AGREED = vi.hoisted(() => ({
  mattersConsidered: 0,
  created: 0,
  kept: 0,
  superseded: 0,
}))

/**
 * What the stubs report, so a test can choose whether a run was claimed, what
 * context it has, and whether `workRun` finished it. The defaults are the
 * door suite's: nothing queued, nothing worked.
 */
const state = vi.hoisted(() => ({
  claimed: { id: null } as { id: string | null },
  context: { ok: false, message: 'no context configured' } as unknown,
  workResult: { done: false, worked: 0 },
  /** What `loadFieldAuditFindings` reports the run stored. */
  findings: [] as FieldAuditFinding[],
  /** `workflow_run_steps` rows, as the route's own reload would read them. */
  stepRows: [] as Record<string, unknown>[],
  /**
   * What the fiduciary sweep does. An `Error` here is thrown rather than
   * returned, which is how the "a failing sweep must not fail the tick" test
   * below drives the route's own catch.
   */
  sweep: SWEPT_NOTHING as FiduciarySweepResult | Error,
  /** The same, for the name check. */
  identitySweep: NAMES_AGREED as IdentitySweepResult | Error,
}))

const sweepFiduciaryTasks = vi.hoisted(() =>
  vi.fn(async (_client: unknown): Promise<FiduciarySweepResult> => {
    if (state.sweep instanceof Error) throw state.sweep
    return state.sweep
  }),
)

const sweepNameAgreement = vi.hoisted(() =>
  vi.fn(async (_client: unknown): Promise<IdentitySweepResult> => {
    if (state.identitySweep instanceof Error) throw state.identitySweep
    return state.identitySweep
  }),
)

/**
 * Typed with the real `EmitTasksInput` rather than as a bare `vi.fn()`, so
 * `mock.calls[0][1]` is the input object the assertions below reach into —
 * and so a route passing a differently shaped input would not typecheck.
 */
const emitTasks = vi.hoisted(() =>
  vi.fn(async (_client: unknown, _input: EmitTasksInput) => ({ created: 0, kept: 0, superseded: 0 })),
)

vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => ({
    rpc: async (name: string) => {
      callOrder.push(name)
      return { data: state.claimed, error: null }
    },
    // The route reloads the run's steps before finalising, and reads which
    // of them failed on the way to `emitTasks`. Most tests here care about
    // neither and leave the default empty set, which is enough to get past
    // the reload.
    from: () => ({ select: () => ({ eq: async () => ({ data: state.stepRows, error: null }) }) }),
  }),
}))

vi.mock('@/lib/runs/reaper', () => ({
  reapAbandonedRuns: async () => ({ reaped: 0 }),
}))

vi.mock('@/lib/runs/triggers', () => ({
  materialiseStageTrigger: async () => {
    callOrder.push('materialiseStageTrigger')
    return { claimed: false, runId: null, status: null }
  },
}))

vi.mock('@/lib/runs/context', () => ({
  loadRunContext: async () => state.context,
}))

vi.mock('@/lib/runs/worker', () => ({
  workRun: async () => state.workResult,
}))

vi.mock('@/lib/runs/record', () => ({
  finaliseRun: async () => {},
}))

vi.mock('@/lib/fieldAudit/history', () => ({
  loadFieldAuditFindings: async () => state.findings,
}))

vi.mock('@/lib/fieldAudit/tasks', () => ({ emitTasks }))

vi.mock('@/lib/fiduciary/sweep', () => ({ sweepFiduciaryTasks }))

vi.mock('@/lib/identity/sweep', () => ({ sweepNameAgreement }))

vi.mock('@/lib/anthropic', () => ({
  // The route catches this by identity to answer 503, so it has to be a real
  // class even though nothing here throws it.
  AnthropicKeyMissingError: class AnthropicKeyMissingError extends Error {},
  anthropicModelCaller: () => async () => {
    throw new Error('the model is never called from this test: workRun is stubbed')
  },
}))

const ORIGINAL_SECRET = process.env.CRON_SECRET

describe('the tick route’s door', () => {
  afterEach(() => {
    // `delete process.env.CRON_SECRET` in the first test must not leak into
    // the ones after it.
    if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = ORIGINAL_SECRET
  })

  it('refuses when the secret is not set', async () => {
    // A queue whose worker authenticates by accident is worse than one that
    // never runs. No secret means no, never "allow".
    delete process.env.CRON_SECRET
    const res = await GET(new Request('http://x/api/cron/tick'))
    expect(res.status).toBe(401)
  })

  it('refuses a wrong secret', async () => {
    process.env.CRON_SECRET = 'right'
    const res = await GET(
      new Request('http://x/api/cron/tick', {
        headers: { authorization: 'Bearer wrong' },
      }),
    )
    expect(res.status).toBe(401)
  })

  it('accepts the cron’s own header', async () => {
    process.env.CRON_SECRET = 'right'
    const res = await GET(
      new Request('http://x/api/cron/tick', {
        headers: { authorization: 'Bearer right' },
      }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      reaped: 0,
      materialised: { claimed: false, runId: null, status: null },
      fiduciary: SWEPT_NOTHING,
      identity: NAMES_AGREED,
      claimedRunId: null,
      worked: 0,
      done: null,
    })
  })

  it('materialises a pending trigger before claiming a run', async () => {
    // Order matters: materialising first means a trigger fired seconds ago
    // is worked by this same tick rather than waiting a minute for the next
    // one.
    process.env.CRON_SECRET = 'right'
    const res = await GET(
      new Request('http://x/api/cron/tick', {
        headers: { authorization: 'Bearer right' },
      }),
    )
    const body = await res.json()
    expect(body).toHaveProperty('materialised')
  })

  it('calls materialiseStageTrigger before claim_workflow_run, not after', async () => {
    // The property check above passes whichever order the two calls happen
    // in — both stubs return a fixed value no matter when they run. This is
    // the test that would actually notice the order being lost: a trigger
    // that fired a second ago is worked by *this* tick only if it is
    // materialised into a run before the claim below runs, not the next
    // minute's tick.
    callOrder.length = 0
    process.env.CRON_SECRET = 'right'
    await GET(
      new Request('http://x/api/cron/tick', {
        headers: { authorization: 'Bearer right' },
      }),
    )
    expect(callOrder).toEqual(['materialiseStageTrigger', 'claim_workflow_run'])
  })
})

/**
 * A field-audit run whose prompt version asked for a `checklist`, worked to
 * `done` in one tick — the only path on which `emitTasks` is ever called.
 *
 * What this pins is not that *a* target reaches `emitTasks` but *which* one:
 * the target comes from the prompt version the run pinned
 * (`context.prompt.body`), never the version currently published. That is why
 * `loadRunContext` reads `workflow_runs.prompt_version_id` rather than going
 * through `prompt_publications` — a prompt republished as `chat` while a
 * `task_set` run is mid-flight across ticks must not retroactively decide that
 * run produces nothing, and a run that pinned `checklist` must still produce
 * its checklist.
 *
 * Before this suite existed nothing tested that line at all. The door suite
 * above deliberately short-circuits at the empty claim, so hardcoding
 * `outputTarget: 'task_set'` in the route in place of `body.outputTarget`
 * passed the entire workbench suite — 1013 tests — without a failure. The
 * target chosen here is `'checklist'` precisely so that hardcode fails.
 */
describe('the tick’s field-audit branch', () => {
  const CONTEXT = {
    ok: true,
    kind: 'field_audit',
    run: {
      id: 'run-1',
      kind: 'field_audit',
      prompt_version_id: 'version-1',
      matter_id: 'matter-1',
      resolved_inputs: {},
      text_layer_id: null,
      document_version_id: null,
      model: null,
    },
    prompt: {
      versionId: 'version-1',
      // The prompt, not the version. Only this prompt's own tasks are the
      // run's to touch, and the version id would scope too narrowly — a
      // republished prompt must still retire its earlier version's tasks.
      promptId: 'prompt-1',
      versionNumber: 3,
      slug: 'ma-design-sheet-audit',
      title: 'MA design sheet audit',
      // The pinned body. A later publication of this prompt is not read at
      // all, which is the whole point.
      body: { kind: 'field_audit', outputTarget: 'checklist', checks: [] },
    },
    values: {},
  }

  const pinned = (outputTarget: string) => ({
    ...CONTEXT,
    prompt: { ...CONTEXT.prompt, body: { ...CONTEXT.prompt.body, outputTarget } },
  })

  beforeEach(() => {
    process.env.CRON_SECRET = 'right'
    state.claimed = { id: 'run-1' }
    state.workResult = { done: true, worked: 1 }
    emitTasks.mockClear()
  })

  afterEach(() => {
    // Back to the door suite's defaults, so test order cannot matter.
    state.claimed = { id: null }
    state.context = { ok: false, message: 'no context configured' }
    state.workResult = { done: false, worked: 0 }
    state.findings = []
    state.stepRows = []
    if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = ORIGINAL_SECRET
  })

  const tick = () =>
    GET(new Request('http://x/api/cron/tick', { headers: { authorization: 'Bearer right' } }))

  it('emits tasks with the output target the run’s own prompt version pinned', async () => {
    state.context = pinned('checklist')

    const res = await tick()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      reaped: 0,
      materialised: { claimed: false, runId: null, status: null },
      fiduciary: SWEPT_NOTHING,
      identity: NAMES_AGREED,
      claimedRunId: 'run-1',
      worked: 1,
      done: true,
    })

    expect(emitTasks).toHaveBeenCalledTimes(1)
    expect(emitTasks.mock.calls[0][1]).toMatchObject({
      matterId: 'matter-1',
      runId: 'run-1',
      // Not `'task_set'`: the value comes from the pinned body, and a
      // hardcoded default would show up right here.
      outputTarget: 'checklist',
      // From the pinned version too — a `checklist` task's title is the
      // prompt's.
      promptTitle: 'MA design sheet audit',
    })
  })

  /**
   * `chat` is asserted to still *call* `emitTasks`, not to skip it. The
   * short-circuit lives inside `emitTasks` on purpose, so it holds for every
   * caller rather than for whichever callers remembered it; a route that
   * skipped the call instead would leave that guard untested from here.
   */
  it('still calls emitTasks for a chat prompt, passing chat through', async () => {
    state.context = pinned('chat')

    const res = await tick()
    expect(res.status).toBe(200)
    expect(emitTasks).toHaveBeenCalledTimes(1)
    expect(emitTasks.mock.calls[0][1]).toMatchObject({ outputTarget: 'chat' })
  })

  /**
   * The tick must pass *all* the findings, not `actionableFindings`. The
   * withdrawal rule needs the outcomes the gate discards — a `compliant` check
   * is what entitles a run to retire an earlier task, and it never survives
   * the gate.
   *
   * The pinned body's `checks` are left empty: `emitTasks` is stubbed, so it
   * is only ever handed them, while `findings` and `failedCheckNumbers` are
   * the two arguments the tick itself computes — and so the only two this can
   * hold it to.
   */
  it('hands emitTasks every finding, and the units that failed', async () => {
    state.context = pinned('checklist')
    // Check 1 came back clean — no task, and the one outcome the gate throws
    // away that the withdrawal rule cannot do without. Check 2 is a deviation
    // the gate would keep.
    state.findings = [
      {
        checkNumber: '1',
        outcome: 'compliant',
        severity: 'low',
        rationale: 'Every concern is answered.',
        references: [],
      },
      {
        checkNumber: '2',
        outcome: 'deviation',
        severity: 'high',
        rationale: 'Nobody named Ruth appears in a structured field.',
        references: [
          {
            fieldKey: 'notes',
            claimedValue: 'Ruth',
            actualValue: 'Ruth',
            matchedPath: null,
            verification: 'verified',
          },
        ],
      },
    ]
    // Check 2's step failed, so whatever finding an earlier attempt left
    // behind, this run did not answer that check.
    state.stepRows = [
      { unit_id: '1', status: 'succeeded', sequence: 0, attempts: 1, last_error: null, finding_id: 'finding-1' },
      { unit_id: '2', status: 'failed', sequence: 1, attempts: 2, last_error: 'timed out', finding_id: 'finding-2' },
    ]

    const res = await tick()
    expect(res.status).toBe(200)
    expect(emitTasks).toHaveBeenCalledTimes(1)
    const passed = vi.mocked(emitTasks).mock.calls[0][1]
    expect(passed.findings).toHaveLength(2)
    expect(passed.findings.map((f) => f.outcome)).toContain('compliant')
    expect(passed.failedCheckNumbers).toEqual(['2'])
    // From the pinned version's prompt, so a run can only ever touch the
    // tasks of the prompt that produced it.
    expect(passed.promptId).toBe('prompt-1')
  })

  /** Tasks belong to a run that is finished, never to one mid-flight. */
  it('emits nothing while the run still has work left', async () => {
    state.context = pinned('checklist')
    state.workResult = { done: false, worked: 1 }

    const res = await tick()
    expect(res.status).toBe(200)
    expect(emitTasks).not.toHaveBeenCalled()
  })
})

/**
 * The fiduciary sweep the tick carries.
 *
 * Two things to hold. Its counts reach the payload, so a tick that created or
 * retired fiduciary tasks says so. And a sweep that throws is caught: the run
 * queue is why this cron exists, and a sweep that cannot read the appointments
 * this minute must cost the queue nothing — the failure is reported and left
 * for the next tick, sixty seconds away.
 */
describe('the tick’s fiduciary sweep', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'right'
    callOrder.length = 0
    sweepFiduciaryTasks.mockClear()
  })

  afterEach(() => {
    // Back to the default, so test order cannot matter.
    state.sweep = SWEPT_NOTHING
    if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = ORIGINAL_SECRET
  })

  const tick = () =>
    GET(new Request('http://x/api/cron/tick', { headers: { authorization: 'Bearer right' } }))

  it('reports what the sweep did', async () => {
    state.sweep = { mattersConsidered: 72, created: 3, kept: 36, superseded: 1, skipped: 2 }

    const res = await tick()

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.fiduciary).toEqual({
      mattersConsidered: 72,
      created: 3,
      kept: 36,
      superseded: 1,
      skipped: 2,
    })
    expect(sweepFiduciaryTasks).toHaveBeenCalledTimes(1)
  })

  it('sweeps before claiming, so the commonest tick still sweeps', async () => {
    // Nothing is queued in this suite's default, and the route returns early
    // on that — which is the commonest tick by far. A sweep placed after the
    // claim would be the sweep that mostly never runs, and this is the
    // assertion that would notice: it would be called zero times.
    await tick()

    expect(sweepFiduciaryTasks).toHaveBeenCalledTimes(1)
  })

  it('works the queue anyway when the sweep throws, and says what failed', async () => {
    state.sweep = new Error('Could not load appointments: connection reset by peer')

    const res = await tick()

    // Not a 500. The queue's own work is untouched by this.
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.fiduciary).toEqual({
      error: 'Could not load appointments: connection reset by peer',
    })
    // The tick went on to do its own work rather than returning at the throw.
    expect(callOrder).toEqual(['materialiseStageTrigger', 'claim_workflow_run'])
    expect(body.claimedRunId).toBeNull()
  })
})

/**
 * The name check the tick carries, beside the fiduciary sweep and held to the
 * same two things.
 *
 * The throw case matters more here than it does there. This sweep *withdraws*
 * tasks when it finds a matter's names now agree, so a query failure absorbed
 * into a zeroed result would not merely under-report — it would report that
 * every flagged name had been resolved. `sweepNameAgreement` throws instead,
 * and this is the assertion that the route carries the throw in the payload
 * rather than dropping the tick on it.
 */
describe('the tick’s name check', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'right'
    callOrder.length = 0
    sweepNameAgreement.mockClear()
  })

  afterEach(() => {
    state.identitySweep = NAMES_AGREED
    if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = ORIGINAL_SECRET
  })

  const tick = () =>
    GET(new Request('http://x/api/cron/tick', { headers: { authorization: 'Bearer right' } }))

  it('reports what the check did', async () => {
    state.identitySweep = { mattersConsidered: 39, created: 3, kept: 0, superseded: 1 }

    const res = await tick()

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.identity).toEqual({
      mattersConsidered: 39,
      created: 3,
      kept: 0,
      superseded: 1,
    })
    expect(sweepNameAgreement).toHaveBeenCalledTimes(1)
  })

  it('checks before claiming, so the commonest tick still checks', async () => {
    await tick()

    expect(sweepNameAgreement).toHaveBeenCalledTimes(1)
  })

  it('works the queue anyway when the check throws, and says what failed', async () => {
    state.identitySweep = new Error('Could not load matters: connection reset by peer')

    const res = await tick()

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.identity).toEqual({
      error: 'Could not load matters: connection reset by peer',
    })
    // Reported, not swallowed — and emphatically not reported as a clean pass,
    // which is what a zeroed result would have looked like.
    expect(body.identity.mattersConsidered).toBeUndefined()
    expect(callOrder).toEqual(['materialiseStageTrigger', 'claim_workflow_run'])
    expect(body.claimedRunId).toBeNull()
  })

  it('does not take the fiduciary sweep down with it', async () => {
    state.identitySweep = new Error('the name check failed')

    const body = await (await tick()).json()

    expect(body.fiduciary).toEqual(SWEPT_NOTHING)
  })
})
