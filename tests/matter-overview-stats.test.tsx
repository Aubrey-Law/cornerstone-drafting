// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MatterOverviewStats } from '@/app/admin/matters/[id]/MatterOverviewStats'

const NOW = Date.UTC(2026, 7, 27, 12, 0, 0)
const DAY = 86_400_000
const iso = (aheadDays: number) => new Date(NOW + aheadDays * DAY).toISOString()

function renderStats(overrides: Partial<React.ComponentProps<typeof MatterOverviewStats>> = {}) {
  const props = {
    taskCounts: { open: 3, overdue: 0 },
    uploads: { intake: 0, portal: 0, total: 0 },
    aging: null,
    signingDate: null,
    nextAppointment: null,
    onOpenTasks: vi.fn(),
    onOpenDocuments: vi.fn(),
    onOpenStageHistory: vi.fn(),
    onOpenDate: vi.fn(),
    ...overrides,
  }
  render(<MatterOverviewStats {...props} />)
  return props
}

describe('MatterOverviewStats', () => {
  afterEach(() => { cleanup(); vi.useRealTimers() })
  beforeEach(() => { vi.useFakeTimers({toFake:['Date']}); vi.setSystemTime(NOW) })

  it('renders each tile as a control, not a readout', () => {
    renderStats()
    // Four tiles, all actionable — a count you cannot act on is half a signal.
    expect(screen.getAllByRole('button')).toHaveLength(4)
  })

  it('opens the tab that holds what a tile counted', () => {
    const props = renderStats()
    fireEvent.click(screen.getByText('Open tasks').closest('button')!)
    expect(props.onOpenTasks).toHaveBeenCalled()

    fireEvent.click(screen.getByText('To review').closest('button')!)
    expect(props.onOpenDocuments).toHaveBeenCalled()
  })

  it('colours open tasks only when some are overdue', () => {
    const { unmount } = render(
      <MatterOverviewStats
        taskCounts={{ open: 3, overdue: 0 }}
        uploads={{ intake: 0, portal: 0, total: 0 }}
        aging={null}
        signingDate={null}
        nextAppointment={null}
        onOpenTasks={vi.fn()}
        onOpenDocuments={vi.fn()}
        onOpenStageHistory={vi.fn()}
        onOpenDate={vi.fn()}
      />,
    )
    expect(screen.getByText('3').className).not.toContain('text-red')
    unmount()

    renderStats({ taskCounts: { open: 3, overdue: 1 } })
    expect(screen.getByText('3').className).toContain('text-red')
    expect(screen.getByText('1 overdue')).toBeTruthy()
  })

  it('says nothing is waiting rather than leaving the review tile bare', () => {
    renderStats()
    expect(screen.getByText('Nothing waiting')).toBeTruthy()
  })

  it('shows an em dash for days in stage when aging is unknown', () => {
    renderStats()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('colours days in stage by SLA health and shows the target', () => {
    renderStats({
      aging: {
        currentStage: 'drafting',
        stageEnteredAt: iso(-20),
        daysInStage: 20,
        slaDays: 14,
        health: 'red',
        isSnoozed: false,
      },
    })
    expect(screen.getByText('20').className).toContain('text-red')
    expect(screen.getByText('Target 14')).toBeTruthy()
  })

  it('shows whichever upcoming date comes first, and says which it is', () => {
    // A meeting before the signing is the thing actually in the way.
    renderStats({ signingDate: iso(20), nextAppointment: iso(3) })
    expect(screen.getByText('Appointment')).toBeTruthy()

    cleanup()
    renderStats({ signingDate: iso(3), nextAppointment: iso(20) })
    expect(screen.getByText('Signing')).toBeTruthy()
  })

  it('reports no scheduled date rather than an empty tile', () => {
    renderStats()
    expect(screen.getByText('None scheduled')).toBeTruthy()
  })
})

it('does not let a past signing displace an upcoming appointment',()=>{
  vi.useFakeTimers({toFake:['Date']}); vi.setSystemTime(NOW)
  const props=renderStats({ signingDate:iso(-3),nextAppointment:iso(2) })
  fireEvent.click(screen.getByRole('button',{name:/Next date/}))
  expect(props.onOpenDate).toHaveBeenCalledWith('2026-08-29')
  expect(screen.getByText('Appointment')).toBeTruthy()
  fireEvent.click(screen.getByRole('button',{name:/Days in stage/}))
  expect(props.onOpenStageHistory).toHaveBeenCalledOnce()
  expect(props.onOpenTasks).not.toHaveBeenCalled()
  cleanup(); vi.useRealTimers()
})
