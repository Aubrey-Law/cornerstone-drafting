// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LeadsClient, type LeadRow } from '@/app/admin/leads/LeadsClient'
import { LeadsBoard } from '@/components/leads/LeadsBoard'

const replace = vi.fn()
let searchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace }),
  usePathname: () => '/admin/leads',
  useSearchParams: () => searchParams,
}))
vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'token' }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

if (!HTMLElement.prototype.hasPointerCapture) {
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { value: () => false })
}
if (!HTMLElement.prototype.scrollIntoView) {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: () => undefined })
}

afterEach(() => {
  cleanup()
  searchParams = new URLSearchParams()
  replace.mockClear()
})

const PARAMS = {
  status: 'open' as const, card: null, search: '', practice: 'all',
  progress: 'all' as const, sort: 'newest' as const, show: 50,
}
const SUMMARY = {
  open: 3, lost: 0, declined: 0, all: 3,
  attention: 0, agreements: 0, awaitingIntake: 0, quotedPipeline: 0,
}

/** The list is server-ranked now, so a render needs the page it was handed. */
function renderLeads(rows: LeadRow[], overrides: Partial<React.ComponentProps<typeof LeadsClient>> = {}) {
  return render(
    <LeadsClient
      initialLeads={rows}
      params={PARAMS}
      total={rows.length}
      hasMore={false}
      summary={{ ...SUMMARY, open: rows.length, all: rows.length }}
      esignEnabled
      {...overrides}
    />,
  )
}

function leadRow(overrides: Partial<LeadRow> & Pick<LeadRow, 'id' | 'full_name'>): LeadRow {
  return {
    first_name: null, last_name: null, email: `${overrides.id}@example.com`, phone: null,
    practice_area: 'EP', status: 'draft', lead_status: 'lead', matter_id: null,
    intake_sent_at: null, intake_completed_at: null, engagement_status: null,
    engagement_sent_at: null, engagement_signed_at: null, engagement_fee_quoted: 2500,
    created_at: '2026-07-20T00:00:00Z', updated_at: '2026-07-20T00:00:00Z',
    lead_urgency: null, taxable_estate: null, last_activity_at: '2026-07-20T00:00:00Z',
    ...overrides,
  }
}

const leads: LeadRow[] = [
  leadRow({ id: 'fresh', full_name: 'Fresh Lead' }),
  leadRow({ id: 'waiting', full_name: 'Waiting Lead', intake_sent_at: '2026-07-21T00:00:00Z' }),
  leadRow({ id: 'signing', full_name: 'Signing Lead', engagement_sent_at: '2026-07-22T00:00:00Z' }),
]

describe('lead board view', () => {
  it('switches to the board from the view toggle and files each lead into its column', async () => {
    const user = userEvent.setup()
    renderLeads(leads)

    await user.click(screen.getByRole('button', { name: 'Board' }))

    expect(replace).toHaveBeenCalledWith('/admin/leads?view=board', { scroll: false })
    expect(within(screen.getByRole('region', { name: 'New' })).getByText('Fresh Lead')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Intake sent' })).getByText('Waiting Lead')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Engagement' })).getByText('Signing Lead')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Hired' })).getByText('Drop to create the matter')).toBeTruthy()
  })

  it('renders the board directly when the URL asks for it', () => {
    searchParams = new URLSearchParams('view=board')
    renderLeads(leads)

    expect(screen.getByRole('button', { name: 'Board' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('keeps the table as the default view', () => {
    renderLeads(leads)
    expect(screen.getByRole('table')).toBeTruthy()
  })
})

describe('what a click on an opportunity opens', () => {
  // Clicking used to open a side panel that only offered a "Full record"
  // button, so reading one lead took two clicks and showed less than the
  // record it linked to.
  it('links a table row straight to the full record', () => {
    renderLeads(leads)
    expect(screen.getByRole('link', { name: 'Fresh Lead' }).getAttribute('href'))
      .toBe('/admin/crm/opportunities/fresh')
  })

  it('links a board card straight to the full record', () => {
    searchParams = new URLSearchParams('view=board')
    renderLeads(leads)
    const card = screen.getByText('Fresh Lead').closest('a')
    expect(card?.getAttribute('href')).toBe('/admin/crm/opportunities/fresh')
  })

  it('leaves no record side panel behind to open', () => {
    renderLeads(leads)
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(screen.queryByRole('button', { name: /full record/i })).toBeNull()
  })
})

describe('lead board drag and drop', () => {
  function renderBoard(handlers: Partial<Record<'onSendIntake' | 'onHire' | 'onMarkLost', () => void>> = {}) {
    const spies = {
      onSendIntake: vi.fn(), onSendEngagement: vi.fn(), onHire: vi.fn(),
      onArchive: vi.fn(), onDelete: vi.fn(), onMarkLost: vi.fn(), onMarkDeclined: vi.fn(), onReopen: vi.fn(),
      onStatusChange: vi.fn(),
      ...handlers,
    }
    render(
      <LeadsBoard
        leads={leads}
        hasAnyLeads
        busyLeadId={null}
        esignEnabled
        onEdit={vi.fn()}
        {...spies}
      />,
    )
    return spies
  }

  /** jsdom has no DataTransfer, so carry the payload through a stub. */
  function dragCardOnto(leadId: string, columnLabel: string) {
    const payload = new Map<string, string>()
    const dataTransfer = {
      setData: (type: string, value: string) => payload.set(type, value),
      getData: (type: string) => payload.get(type) ?? '',
      effectAllowed: 'none',
    }
    const card = screen.getByText(leadId).closest('article')
    fireEvent.dragStart(card!, { dataTransfer })
    fireEvent.drop(screen.getByRole('region', { name: columnLabel }), { dataTransfer })
  }

  it('runs the target column\'s action when a card is dropped on it', () => {
    const spies = renderBoard()
    dragCardOnto('Fresh Lead', 'Intake sent')
    expect(spies.onSendIntake).toHaveBeenCalledWith(expect.objectContaining({ id: 'fresh' }))

    dragCardOnto('Signing Lead', 'Hired')
    expect(spies.onHire).toHaveBeenCalledWith(expect.objectContaining({ id: 'signing' }))

    dragCardOnto('Waiting Lead', 'Lost')
    expect(spies.onMarkLost).toHaveBeenCalledWith(expect.objectContaining({ id: 'waiting' }))
  })

  it('offers the same row actions from a card', async () => {
    const user = userEvent.setup()
    const spies = renderBoard()
    await user.click(screen.getByRole('button', { name: 'More actions for Fresh Lead' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Send intake' }))
    expect(spies.onSendIntake).toHaveBeenCalledWith(expect.objectContaining({ id: 'fresh' }))
  })

  it('does nothing when the column cannot be reached by a drop', () => {
    const spies = renderBoard()
    dragCardOnto('Fresh Lead', 'Intake complete')
    expect(spies.onSendIntake).not.toHaveBeenCalled()
    expect(spies.onHire).not.toHaveBeenCalled()
  })
})

describe('what a board card is scanned for', () => {
  it('shows when, where it used to show a derived identifier', async () => {
    // The second line was the provisional lead number — a synthetic id for a
    // record with no matter yet, and nothing anyone can act on.
    searchParams = new URLSearchParams('view=board')
    renderLeads([leadRow({
      id: 'booked',
      full_name: 'Booked Bella',
      next_appointment_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    })])

    expect(screen.getByText(/Meeting in \d+ days/)).toBeTruthy()
    expect(screen.queryByText(/^\d{4}-EP-/)).toBeNull()
  })

  it('names why a lead needs attention instead of just flagging it', () => {
    // "Needs attention" was true of 16 of 35 leads, which told the reader
    // nothing about which one to open.
    searchParams = new URLSearchParams('view=board')
    renderLeads([leadRow({
      id: 'urgent',
      full_name: 'Urgent Uma',
      lead_urgency: 'high',
      last_activity_at: new Date().toISOString(),
    })])

    // Scoped to the card: "Needs attention" is also the name of a filter chip
    // in the insights strip above the board, which stays.
    const card = screen.getByRole('article')
    expect(within(card).getByText('High urgency')).toBeTruthy()
    expect(within(card).queryByText('Needs attention')).toBeNull()
  })

  it('falls back to the plan when no fee has been quoted', () => {
    // One lead in thirty-five had a fee; thirteen had a carrier.
    searchParams = new URLSearchParams('view=board')
    renderLeads([leadRow({
      id: 'plan',
      full_name: 'Plan Pat',
      engagement_fee_quoted: null,
      billing_type: 'metlife',
    })])

    expect(screen.getByText('MetLife')).toBeTruthy()
  })
})
