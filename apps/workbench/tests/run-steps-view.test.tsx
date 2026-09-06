// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { RunSteps } from '@/app/runs/RunSteps'

afterEach(() => {
  cleanup()
})

describe('RunSteps', () => {
  it('says how far along a queued run is', () => {
    render(
      <RunSteps
        steps={[
          { unitId: '1', status: 'succeeded', attempts: 1, sequence: 0, lastError: null },
          { unitId: '2', status: 'running', attempts: 1, sequence: 1, lastError: null },
          { unitId: '3', status: 'pending', attempts: 0, sequence: 2, lastError: null },
        ]}
        runStatus="running"
        unitNoun="check"
      />,
    )
    expect(screen.getByText(/1 of 3/)).toBeInTheDocument()
  })

  it('offers no retry while the run is still going', () => {
    // Retrying a run a worker currently holds would race it.
    render(
      <RunSteps
        steps={[
          { unitId: '1', status: 'failed', attempts: 1, sequence: 0, lastError: 'overloaded' },
          { unitId: '2', status: 'pending', attempts: 0, sequence: 1, lastError: null },
        ]}
        runStatus="running"
        unitNoun="check"
        onRetry={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull()
  })

  it('offers retry once the run has settled and a step failed', () => {
    // The other side of the guard above: hidden while running, shown once
    // settled — otherwise a failed run could never be retried at all.
    render(
      <RunSteps
        steps={[
          { unitId: '1', status: 'succeeded', attempts: 1, sequence: 0, lastError: null },
          { unitId: '2', status: 'failed', attempts: 1, sequence: 1, lastError: 'overloaded' },
        ]}
        runStatus="partial"
        unitNoun="check"
        onRetry={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: /retry 1 failed check/i })).toBeEnabled()
  })

  it('shows each step’s own state, including pending and running', () => {
    render(
      <RunSteps
        steps={[
          { unitId: '1', status: 'pending', attempts: 0, sequence: 0, lastError: null },
          { unitId: '2', status: 'running', attempts: 1, sequence: 1, lastError: null },
        ]}
        runStatus="running"
        unitNoun="check"
      />,
    )
    expect(screen.getByText(/^pending$/)).toBeInTheDocument()
    expect(screen.getByText(/^running/)).toBeInTheDocument()
  })
})
