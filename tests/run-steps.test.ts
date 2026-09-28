import { describe, expect, it } from 'vitest'
import { statusFromSteps, unitsToRetry } from '@/lib/runs/steps'

const step = (unitId: string, status: 'pending' | 'running' | 'succeeded' | 'failed') =>
  ({ unitId, status, attempts: 1, sequence: Number(unitId) })

describe('a run’s status, read from its steps', () => {
  it('is completed only when every step succeeded', () => {
    expect(statusFromSteps([step('1', 'succeeded'), step('2', 'succeeded')])).toBe('completed')
  })

  it('is partial when some succeeded and some failed', () => {
    // `completed` may not describe a run that lost a unit — that overstates
    // its coverage in the one field a reader skims.
    expect(statusFromSteps([step('1', 'succeeded'), step('2', 'failed')])).toBe('partial')
  })

  it('is failed when nothing succeeded', () => {
    expect(statusFromSteps([step('1', 'failed'), step('2', 'failed')])).toBe('failed')
  })

  it('is running while any step has not settled', () => {
    // A run with work outstanding is not a run with a verdict.
    expect(statusFromSteps([step('1', 'succeeded'), step('2', 'pending')])).toBe('running')
    expect(statusFromSteps([step('1', 'running')])).toBe('running')
  })

  it('is failed for a run with no steps at all', () => {
    // Nothing ran. Calling that `completed` would say a review happened.
    expect(statusFromSteps([])).toBe('failed')
  })
})

describe('which units a retry runs', () => {
  it('takes the failed ones, in sequence order', () => {
    expect(unitsToRetry([step('2', 'failed'), step('1', 'succeeded'), step('3', 'failed')]))
      .toEqual(['2', '3'])
  })

  it('takes nothing when nothing failed', () => {
    // The caller must be able to tell "nothing to do" from "retry everything".
    expect(unitsToRetry([step('1', 'succeeded')])).toEqual([])
  })

  it('does not take a step that never settled', () => {
    // A pending step was never attempted. Retrying it would be a first
    // attempt wearing a retry's name, and its attempt count would lie.
    expect(unitsToRetry([step('1', 'pending'), step('2', 'failed')])).toEqual(['2'])
  })
})
