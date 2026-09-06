import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from '@/lib/supabase/database'
import { stepRowFor, openRunRowFor, openSteps } from '@/lib/runs/record'
import { makeFakeClient } from './helpers/fakeSupabase'

describe('the rows a run is recorded with', () => {
  it('opens a run as queued, before a tick has claimed it', () => {
    // A caller enqueues and returns now — it no longer runs the engine
    // itself. `running` means a tick holds the run; until one claims it, the
    // run sits `queued`.
    const row = openRunRowFor({
      matterId: 'm1', kind: 'field_audit', promptVersionId: 'v1', model: 'claude-sonnet-5',
      unitTotal: 6, userId: null, resolvedInputs: { concerns: 'x' },
      documentVersionId: null, textLayerId: null,
    })
    expect(row.status).toBe('queued')
    expect(row.rule_total).toBe(6)
    expect(row.finding_count).toBe(0)
    expect(row.failed_count).toBe(0)
    expect(row.finished_at).toBeNull()
    expect(row.resolved_inputs).toEqual({ concerns: 'x' })
  })

  it('records a settled step with its attempt count and outcome', () => {
    expect(stepRowFor('run-1', '3', 2, { ok: false, reason: 'overloaded' }, 1)).toEqual({
      run_id: 'run-1', unit_id: '3', sequence: 2, status: 'failed',
      attempts: 1, last_error: 'overloaded',
      started_at: expect.any(String), finished_at: expect.any(String),
    })
  })

  it('records a succeeded step with no error', () => {
    const row = stepRowFor('run-1', '1', 0, { ok: true }, 1)
    expect(row.status).toBe('succeeded')
    expect(row.last_error).toBeNull()
  })
})

describe('openSteps', () => {
  it('writes one pending step per unit, in the order given, before any work happens', async () => {
    const client = makeFakeClient()
    await openSteps(client as unknown as SupabaseClient<WorkbenchDatabase>, 'run-1', ['1', '2', '3'])

    const steps = client.tableRows('workflow_run_steps')
    expect(steps).toHaveLength(3)
    expect(steps.every((step) => step.run_id === 'run-1')).toBe(true)
    // Sequence is the unit's position in the body, not insertion order —
    // this is what lets a run read back in playbook order.
    expect(steps.map((step) => step.unit_id)).toEqual(['1', '2', '3'])
    expect(steps.map((step) => step.sequence)).toEqual([0, 1, 2])
    // A run's shape ("3 of 40") is known from this moment, before any unit
    // has actually been attempted.
    expect(steps.every((step) => step.status === 'pending')).toBe(true)
    expect(steps.every((step) => step.attempts === 0)).toBe(true)
    expect(steps.every((step) => step.started_at === null && step.finished_at === null)).toBe(true)
  })
})
