import { describe, expect, it } from 'vitest'
import { stepRowFor, openRunRowFor } from '@/lib/runs/record'

describe('the rows a run is recorded with', () => {
  it('opens a run as running, before anything has happened to it', () => {
    // The run has to exist before the engine starts, so its steps have
    // something to reference — and so a run that dies leaves a trace.
    const row = openRunRowFor({
      matterId: 'm1', kind: 'field_audit', promptVersionId: 'v1', model: 'claude-sonnet-5',
      unitTotal: 6, userId: null, resolvedInputs: { concerns: 'x' },
      documentVersionId: null, textLayerId: null,
    })
    expect(row.status).toBe('running')
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
