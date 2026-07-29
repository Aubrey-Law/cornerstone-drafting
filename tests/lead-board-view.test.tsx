// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LeadsClient, type LeadRow } from '@/app/admin/leads/LeadsClient'
import { LeadsBoard } from '@/components/leads/LeadsBoard'
import { LeadSidePanel } from '@/components/leads/LeadSidePanel'

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
    render(<LeadsClient initialLeads={leads} esignEnabled />)

    await user.click(screen.getByRole('button', { name: 'Board' }))

    expect(replace).toHaveBeenCalledWith('/admin/leads?view=board', { scroll: false })
    expect(within(screen.getByRole('region', { name: 'New' })).getByText('Fresh Lead')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Intake sent' })).getByText('Waiting Lead')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Engagement' })).getByText('Signing Lead')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Hired' })).getByText('Drop to create the matter')).toBeTruthy()
  })

  it('renders the board directly when the URL asks for it', () => {
    searchParams = new URLSearchParams('view=board')
    render(<LeadsClient initialLeads={leads} esignEnabled />)

    expect(screen.getByRole('button', { name: 'Board' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('keeps the table as the default view', () => {
    render(<LeadsClient initialLeads={leads} esignEnabled />)
    expect(screen.getByRole('table')).toBeTruthy()
  })
})

describe('lead board drag and drop', () => {
  function renderBoard(handlers: Partial<Record<'onSendIntake' | 'onHire' | 'onMarkLost', () => void>> = {}) {
    const spies = {
      onSendIntake: vi.fn(), onSendEngagement: vi.fn(), onHire: vi.fn(),
      onArchive: vi.fn(), onMarkLost: vi.fn(), onReopen: vi.fn(),
      ...handlers,
    }
    render(
      <LeadsBoard
        leads={leads}
        hasAnyLeads
        busyLeadId={null}
        esignEnabled
        onActivate={vi.fn()}
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

describe('lead record panel width', () => {
  it('expands and collapses from the header toggle and remembers the choice', async () => {
    const user = userEvent.setup()
    const panel = (
      <LeadSidePanel
        lead={leads[0]!}
        spouse={null}
        onClose={vi.fn()}
        onOpenFullRecord={vi.fn()}
        onOpenRowMenu={vi.fn()}
        onLeadSaved={vi.fn()}
      />
    )
    const { unmount } = render(panel)

    const record = screen.getByRole('complementary', { name: 'Fresh Lead record' })
    expect(record.className).toContain('w-[440px]')

    await user.click(screen.getByRole('button', { name: 'Expand record panel' }))
    expect(record.className).toContain('w-[min(60rem,58vw)]')
    expect(window.localStorage.getItem('cornerstone.leadPanelWide')).toBe('1')

    unmount()
    render(panel)
    expect(screen.getByRole('button', { name: 'Collapse record panel' })).toBeTruthy()
  })
})
