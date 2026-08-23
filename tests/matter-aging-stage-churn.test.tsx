// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { MatterAgingRow, MatterAgingTiles } from '@/lib/queries/pipelineAging'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

import MatterAgingClient from '@/app/admin/pipeline/aging/MatterAgingClient'

afterEach(cleanup)

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
