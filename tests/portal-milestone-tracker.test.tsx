// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PortalMilestoneTracker, milestoneFrontier } from '@/components/portal/PortalMilestoneTracker'
import type { PortalMilestone } from '@/lib/portal/progress'

const steps = (...states: PortalMilestone['state'][]): PortalMilestone[] =>
  states.map((state, index) => ({ key: `step-${index}`, label: `Step ${index + 1}`, state }))

describe('portal milestone tracker', () => {
  afterEach(() => cleanup())

  it('marks the frontier only when earlier steps are complete', () => {
    expect(milestoneFrontier(steps('completed', 'pending', 'pending'))).toBe(1)
    expect(milestoneFrontier(steps('pending', 'pending', 'completed'))).toBe(-1)
    expect(milestoneFrontier(steps('completed', 'completed'))).toBe(-1)
    expect(milestoneFrontier(steps('pending', 'pending'))).toBe(0)
  })

  it('exposes the current step to assistive tech and keeps pending steps quiet', () => {
    render(<PortalMilestoneTracker milestones={steps('completed', 'pending', 'pending')} />)

    const items = screen.getAllByRole('listitem')
    expect(items[0]?.textContent).toContain('Complete')
    expect(items[1]?.getAttribute('aria-current')).toBe('step')
    expect(items[1]?.textContent).toContain('Current step')
    expect(items[2]?.getAttribute('aria-current')).toBeNull()
    expect(items[2]?.textContent).toContain('Not started')
  })

  it('does not invent a current step when a later date is recorded before an earlier one', () => {
    render(<PortalMilestoneTracker milestones={steps('pending', 'completed')} />)
    expect(screen.queryByRole('listitem', { current: 'step' })).toBeNull()
  })

  it('states that progress has not been shared yet', () => {
    render(<PortalMilestoneTracker milestones={[]} />)
    expect(screen.getByRole('status').textContent).toContain('The firm will share progress updates through Messages.')
    expect(screen.queryByRole('list', { name: 'Plan progress' })).toBeNull()
  })
})
