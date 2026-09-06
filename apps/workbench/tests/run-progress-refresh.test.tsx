// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { RunStatus } from '@/lib/runs/steps'

// Follows tests/review-workspace.test.tsx's mock of next/navigation: the
// component under test only needs `useRouter().refresh`.
const routerRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: routerRefresh }),
}))

import { RunProgressRefresh } from '@/app/runs/RunProgressRefresh'

describe('RunProgressRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    routerRefresh.mockClear()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('refreshes on an interval while the run is running', () => {
    render(<RunProgressRefresh runStatus="running" />)

    expect(routerRefresh).not.toHaveBeenCalled()

    vi.advanceTimersByTime(5000)
    expect(routerRefresh).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(5000)
    expect(routerRefresh).toHaveBeenCalledTimes(2)
  })

  // `RunStatus` (lib/runs/steps.ts) has no `queued` member — `statusFromSteps`
  // never produces it, because a run's steps are inserted `pending` at
  // enqueue time, before the run itself is claimed, so a caller reading a run
  // back through `statusFromSteps` already sees `running` rather than
  // `queued`. The component still has to be correct for `queued` on its own
  // terms, because it does not special-case `running` — it polls for
  // anything that is not one of the three settled statuses, so `queued`
  // polls for the same reason `running` does. The cast stands in for a
  // caller that passes the raw `workflow_runs.status` column instead of a
  // steps-derived status.
  it('refreshes on an interval while the run is queued', () => {
    render(<RunProgressRefresh runStatus={'queued' as RunStatus} />)

    vi.advanceTimersByTime(5000)
    expect(routerRefresh).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(5000)
    expect(routerRefresh).toHaveBeenCalledTimes(2)
  })

  it.each<RunStatus>(['completed', 'partial', 'failed'])(
    'sets no interval at all once the run is %s',
    (settledStatus) => {
      render(<RunProgressRefresh runStatus={settledStatus} />)

      // A long advance — long enough to catch a poller that fires even once
      // and then only cancels for the next tick, rather than never being set
      // in the first place.
      vi.advanceTimersByTime(60 * 60 * 1000)
      expect(routerRefresh).not.toHaveBeenCalled()
    },
  )

  it('stops polling when the status changes from running to completed on a rerender', () => {
    const { rerender } = render(<RunProgressRefresh runStatus="running" />)

    vi.advanceTimersByTime(5000)
    expect(routerRefresh).toHaveBeenCalledTimes(1)

    rerender(<RunProgressRefresh runStatus="completed" />)

    // The interval set while `running` must have been cleared by the
    // rerender — advancing well past several would-be ticks should produce
    // no further calls.
    vi.advanceTimersByTime(30000)
    expect(routerRefresh).toHaveBeenCalledTimes(1)
  })
})
