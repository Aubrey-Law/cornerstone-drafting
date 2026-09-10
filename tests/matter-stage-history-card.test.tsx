// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildStageTimeline, type MatterStageHistoryRow } from '@/lib/matters/stageTimeline'
import {
  MatterStageHistoryCard,
  historicalStageLabel,
} from '@/app/admin/matters/[id]/MatterStageHistoryCard'

afterEach(cleanup)

const row = (
  overrides: Partial<MatterStageHistoryRow> & { id: number; to_stage: string; entered_at: string },
): MatterStageHistoryRow => ({
  from_stage: null,
  created_at: overrides.entered_at,
  actor_id: null,
  ...overrides,
})

const timeline = (rows: MatterStageHistoryRow[], actors?: Map<string, string>) =>
  buildStageTimeline(rows, actors)

describe('MatterStageHistoryCard', () => {
  it('reads newest first and marks the current stage', () => {
    render(<MatterStageHistoryCard entries={timeline([
      row({ id: 1, to_stage: 'intake', entered_at: '2026-08-01T12:00:00Z' }),
      row({ id: 2, from_stage: 'intake', to_stage: 'design', entered_at: '2026-08-06T12:00:00Z' }),
      row({ id: 3, from_stage: 'design', to_stage: 'drafting', entered_at: '2026-08-20T12:00:00Z' }),
    ])} />)

    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(items[0].textContent).toContain('Drafting')
    expect(items[0].textContent).toContain('current')
    expect(items[2].textContent).toContain('Intake')
    expect(items[2].textContent).not.toContain('current')
  })

  it('shows how long a finished stage lasted and how long the open one has run', () => {
    render(<MatterStageHistoryCard entries={timeline([
      row({ id: 1, to_stage: 'intake', entered_at: '2026-08-01T12:00:00Z' }),
      row({ id: 2, from_stage: 'intake', to_stage: 'design', entered_at: '2026-08-06T12:00:00Z' }),
    ])} />)

    // Anchored: the open stage renders "N days so far", and an unanchored
    // /5 days/ also matches "35 days" on the 35th day, which made this assert
    // "found multiple elements" on one calendar day in every ten.
    expect(screen.getByText(/\b5 days/)).toBeTruthy()
    expect(screen.getByText(/so far/)).toBeTruthy()
  })

  it('names the stage a matter moved from, and does not invent one for the first entry', () => {
    render(<MatterStageHistoryCard entries={timeline([
      row({ id: 1, to_stage: 'intake', entered_at: '2026-08-01T12:00:00Z' }),
      row({ id: 2, from_stage: 'intake', to_stage: 'design', entered_at: '2026-08-06T12:00:00Z' }),
    ])} />)

    const items = screen.getAllByRole('listitem')
    expect(items[0].textContent).toMatch(/from Intake/)
    // The earliest row is a starting point, not an observed transition.
    expect(items[1].textContent).toMatch(/Recorded from/)
    expect(items[1].textContent).not.toMatch(/ from [A-Z]/)
  })

  it('attributes a transition when an actor was recorded', () => {
    render(<MatterStageHistoryCard entries={timeline(
      [
        row({ id: 1, to_stage: 'intake', entered_at: '2026-08-01T12:00:00Z' }),
        row({ id: 2, from_stage: 'intake', to_stage: 'design', entered_at: '2026-08-06T12:00:00Z', actor_id: 'u1' }),
      ],
      new Map([['u1', 'Scott Aubrey']]),
    )} />)

    expect(screen.getByText('By Scott Aubrey')).toBeTruthy()
  })

  it('collapses a long history behind a disclosure', async () => {
    const user = userEvent.setup()
    const rows = Array.from({ length: 9 }, (_, index) =>
      row({ id: index + 1, to_stage: 'design', entered_at: `2026-08-0${index + 1}T12:00:00Z` }),
    )
    render(<MatterStageHistoryCard entries={timeline(rows)} />)

    expect(screen.getAllByRole('listitem')).toHaveLength(6)
    await user.click(screen.getByRole('button', { name: /Show 3 earlier entries/ }))
    expect(screen.getAllByRole('listitem')).toHaveLength(9)
  })

  it('explains an empty history rather than rendering an empty rail', () => {
    render(<MatterStageHistoryCard entries={[]} />)

    expect(screen.getByText(/No stage moves recorded yet/)).toBeTruthy()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('collapses from the header', async () => {
    const user = userEvent.setup()
    render(<MatterStageHistoryCard entries={timeline([
      row({ id: 1, to_stage: 'intake', entered_at: '2026-08-01T12:00:00Z' }),
    ])} />)

    const header = screen.getByRole('button', { expanded: true })
    await user.click(header)
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('does not add a second stage selector to the page', () => {
    // matter-overview-frame asserts the header holds the only one.
    const { container } = render(<MatterStageHistoryCard entries={timeline([
      row({ id: 1, to_stage: 'intake', entered_at: '2026-08-01T12:00:00Z' }),
    ])} />)

    expect(container.querySelector('select')).toBeNull()
    expect(container.querySelector('[aria-label="Matter stage"]')).toBeNull()
  })
})

describe('historicalStageLabel', () => {
  it('uses the canonical label for a known stage', () => {
    expect(historicalStageLabel('intake_review')).toBe('Intake Review')
    expect(historicalStageLabel('post_execution')).toBe('Post-Execution')
  })

  it('title-cases a retired stage rather than showing a raw slug', () => {
    // The history columns carry no CHECK on purpose, so a stage that has since
    // been renamed still has to render.
    expect(historicalStageLabel('legacy_onboarding')).toBe('Legacy Onboarding')
  })
})
