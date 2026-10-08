// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { MatterAgingRow, MatterAgingTiles } from '@/lib/queries/pipelineAging'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))
vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'test-token' }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

import MatterAgingClient from '@/app/admin/pipeline/aging/MatterAgingClient'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks() })

const TILES: MatterAgingTiles = { active: 1, red: 0, amber: 1, green: 0, overdue: 0, snoozed: 1 }

function agingRow(overrides: Partial<MatterAgingRow> = {}): MatterAgingRow {
  return {
    entity: 'matter',
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    client_name: 'Dana Reyes',
    client_email: null,
    client_phone: null,
    track: 'DEFAULT',
    current_stage: 'client_review',
    stage_order: 5,
    owner: 'client',
    stage_entered_at: '2026-06-29T12:00:00Z',
    days_in_stage: 6,
    sla_days: 10,
    escalation_offset: null,
    is_overdue: false,
    needs_outreach: false,
    // The board defaults to the "Needs attention" filter, which hides green and
    // snoozed rows, so the fixture has to be one the default view shows.
    health: 'amber',
    raw_health: 'amber',
    days_over_sla: null,
    snooze_id: null,
    snoozed_until: null,
    snooze_reason: null,
    is_snoozed: false,
    stage_visits: 1,
    cumulative_days: 6,
    cumulative_sla_days: 10,
    is_cumulative_overdue: false,
    is_scheduled: false,
    stage_clock_suspect: false,
    ...overrides,
  }
}

const board = (row: MatterAgingRow) =>
  render(<MatterAgingClient initialRows={[row]} initialTiles={TILES} />)

describe('aging board stage churn', () => {
  it('surfaces total time across visits when a stage has been re-entered', () => {
    // The blind spot this closes: stage_entered_at resets on re-entry, so a
    // matter cycling through the revision loop reads as 6 days old while it has
    // actually been in Client Review for 50.
    board(agingRow({ days_in_stage: 6, stage_visits: 3, cumulative_days: 50 }))

    expect(screen.getByText(/50d total · 3 visits/)).toBeTruthy()
  })

  it('stays quiet on a stage entered only once', () => {
    board(agingRow({ stage_visits: 1, cumulative_days: 6 }))

    expect(screen.queryByText(/total ·/)).toBeNull()
  })

  it('stays quiet when no history has been recorded for the row', () => {
    board(agingRow())

    expect(screen.queryByText(/total ·/)).toBeNull()
  })

  it('explains that the SLA measures only the current visit', () => {
    board(agingRow({ stage_visits: 2, cumulative_days: 21 }))

    const note = screen.getByTitle(/entered 2 times, for 21 business days in total/)
    expect(note.textContent).toContain('21d total · 2 visits')
    expect(note.getAttribute('title')).toContain('measures only the current visit')
  })

  it('shows churn on a stage that has no SLA target', () => {
    board(agingRow({ sla_days: null, stage_visits: 4, cumulative_days: 30 }))

    expect(screen.getByText(/no SLA/)).toBeTruthy()
    expect(screen.getByText(/30d total · 4 visits/)).toBeTruthy()
  })

  it('leaves a snoozed row showing its snooze rather than churn', async () => {
    const user = userEvent.setup()
    board(agingRow({
      is_snoozed: true,
      snoozed_until: '2026-09-01T12:00:00Z',
      stage_visits: 3,
      cumulative_days: 50,
    }))

    // Snoozed rows are hidden under the default filter.
    await user.click(screen.getByRole('button', { name: /Snoozed/ }))
    expect(screen.getByText(/Snoozed until/)).toBeTruthy()
    expect(screen.queryByText(/total ·/)).toBeNull()
  })
})

describe('cumulative SLA breach', () => {
  it('flags the row when the total is over budget even though the current visit is fresh', () => {
    // The whole point: one day into a five-day stage looks healthy, but this
    // matter has spent 11 of its 10 allowed days here across two rounds.
    board(agingRow({
      days_in_stage: 1,
      sla_days: 5,
      days_over_sla: -4,
      stage_visits: 2,
      cumulative_days: 11,
      cumulative_sla_days: 10,
      is_cumulative_overdue: true,
      health: 'red',
      raw_health: 'red',
      is_overdue: true,
    }))

    const note = screen.getByTitle(/Over the total budget for this stage/)
    expect(note.textContent).toContain('11/10d total · 2 visits')
    expect(note.className).toContain('text-red-strong')
  })

  it('shows a breach even on a first visit, where churn alone would say nothing', () => {
    board(agingRow({
      stage_visits: 1,
      cumulative_days: 12,
      cumulative_sla_days: 10,
      is_cumulative_overdue: true,
    }))

    expect(screen.getByText(/12\/10d total · 1 visit/)).toBeTruthy()
  })

  it('reports visits without a budget when the stage has no cumulative rule', () => {
    board(agingRow({ stage_visits: 3, cumulative_days: 30, cumulative_sla_days: null }))

    const note = screen.getByTitle(/entered 3 times/)
    expect(note.textContent).toContain('30d total · 3 visits')
    expect(note.getAttribute('title')).not.toContain('allowed')
  })
})

describe('a lead whose clock has not started', () => {
  /**
   * Both rows are green, and green is what the default "Needs attention" view
   * exists to hide — which is the point of the change, so the test looks where
   * a healthy row actually lives.
   */
  async function onTrack(row: MatterAgingRow) {
    const user = userEvent.setup()
    board(row)
    await user.click(screen.getByText('On track'))
  }

  it('shows the date and no SLA bar for a booked call', async () => {
    // Twelve rows sat amber at zero days in stage because the discovery clock
    // starts at the scheduled call. A booked meeting is not a lead going cold.
    await onTrack(agingRow({
      entity: 'lead',
      current_stage: 'discovery_call',
      is_scheduled: true,
      health: 'green',
      days_in_stage: 0,
      sla_days: 1,
      stage_entered_at: '2026-09-09T12:00:00Z',
    }))

    expect(screen.getByText('Scheduled — clock starts then')).toBeTruthy()
    expect(screen.queryByText('0/1d')).toBeNull()
  })

  it('asks for the date to be checked when the milestone predates the record', async () => {
    // One lead's discovery call is recorded as 1969-09-02, which reported
    // 14,864 days in stage. Measuring from creation stops it dominating the
    // board; saying so is what gets the date fixed.
    await onTrack(agingRow({
      entity: 'lead',
      current_stage: 'intake_completed',
      stage_clock_suspect: true,
      health: 'green',
      days_in_stage: 0,
    }))

    expect(screen.getByText('Check the date')).toBeTruthy()
    expect(screen.getByText(/measured from creation instead/)).toBeTruthy()
  })
})


describe('aging controls and request recovery', () => {
  it('searches by readable stage name and clears both filters', async () => {
    const user = userEvent.setup()
    board(agingRow())
    await user.type(screen.getByRole('searchbox', { name: 'Search aging records' }), 'Client Review')
    expect(screen.getByRole('link', { name: 'Dana Reyes' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Show all records' }))
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('')
    expect(screen.getByRole('button', { name: /^1 All$/ }).getAttribute('aria-pressed')).toBe('true')
  })

  it('keeps loaded rows visible after a network failure and offers retry', async () => {
    const user = userEvent.setup()
    const request = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ ok: true, json: async () => ({ rows: [agingRow()], tiles: TILES }) })
    vi.stubGlobal('fetch', request)
    board(agingRow())
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('last loaded results'))
    expect(screen.getByRole('link', { name: 'Dana Reyes' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('keeps a failed snooze open for retry and rejects fractional days', async () => {
    const user = userEvent.setup()
    const request = vi.fn().mockRejectedValue(new Error('Offline'))
    vi.stubGlobal('fetch', request)
    board(agingRow())
    await user.click(screen.getByRole('button', { name: 'Snooze' }))
    const dialog = screen.getByRole('dialog')
    const days = within(dialog).getByRole('spinbutton')
    await user.clear(days)
    await user.type(days, '1.5')
    await user.click(within(dialog).getByRole('button', { name: 'Snooze' }))
    expect(request).not.toHaveBeenCalled()
    await user.clear(days)
    await user.type(days, '3')
    await user.click(within(dialog).getByRole('button', { name: 'Snooze' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not snooze. Please retry.'))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Snooze' }).hasAttribute('disabled')).toBe(false)
  })

  it('does not claim all records are on track when some are snoozed', () => {
    board(agingRow({ is_snoozed: true }))
    expect(screen.getByText(/Review Snoozed to see paused alerts/)).toBeTruthy()
  })
})
