// @vitest-environment jsdom

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LeadsClient, type LeadRow } from '@/app/admin/leads/LeadsClient'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'token' }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

if (!HTMLElement.prototype.hasPointerCapture) {
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { value: () => false })
}
if (!HTMLElement.prototype.scrollIntoView) {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: () => undefined })
}

afterEach(cleanup)

const leadRows: LeadRow[] = [
  {
    id: 'zoe', full_name: 'Zoe Beta', first_name: 'Zoe', last_name: 'Beta', email: 'zoe@example.com', phone: '617-555-0101',
    practice_area: 'EP', status: 'draft', lead_status: 'lead', matter_id: null, intake_sent_at: '2026-07-20T00:00:00Z', intake_completed_at: null,
    engagement_status: null, engagement_sent_at: null, engagement_signed_at: null, engagement_fee_quoted: 2500,
    created_at: '2026-07-20T00:00:00Z', updated_at: '2026-07-20T00:00:00Z', lead_urgency: null, taxable_estate: null, last_activity_at: '2026-07-20T00:00:00Z',
  },
  {
    id: 'jane', full_name: 'Jane Alpha', first_name: 'Jane', last_name: 'Alpha', email: 'jane@example.com', phone: '617-555-0102',
    practice_area: 'EP', status: 'draft', lead_status: 'lead', matter_id: null, intake_sent_at: null, intake_completed_at: null,
    engagement_status: null, engagement_sent_at: null, engagement_signed_at: null, engagement_fee_quoted: 1500,
    created_at: '2026-07-19T00:00:00Z', updated_at: '2026-07-19T00:00:00Z', lead_urgency: null, taxable_estate: null, last_activity_at: '2026-07-19T00:00:00Z',
  },
  {
    id: 'aaron', full_name: 'Aaron Gamma', first_name: 'Aaron', last_name: 'Gamma', email: 'aaron@example.com', phone: '617-555-0103',
    practice_area: 'Probate', status: 'draft', lead_status: 'lead', matter_id: null, intake_sent_at: null, intake_completed_at: null,
    engagement_status: null, engagement_sent_at: null, engagement_signed_at: null, engagement_fee_quoted: 1000,
    created_at: '2026-07-18T00:00:00Z', updated_at: '2026-07-18T00:00:00Z', lead_urgency: null, taxable_estate: null, last_activity_at: '2026-07-18T00:00:00Z',
  },
]

async function selectOption(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
  await user.click(screen.getByRole('combobox', { name: label }))
  await user.click(await screen.findByRole('option', { name: option }))
}

function visibleLeadNames(): string[] {
  return screen.getAllByRole('link')
    .filter(link => link.getAttribute('href')?.startsWith('/admin/leads/'))
    .map(link => link.textContent ?? '')
}

describe('lead list controls', () => {
  it('searches and filters leads before applying the selected sort', async () => {
    const user = userEvent.setup()
    render(<LeadsClient initialLeads={leadRows} esignEnabled />)

    await user.type(screen.getByRole('searchbox', { name: 'Search leads' }), 'jane')
    expect(screen.getByRole('link', { name: 'Jane Alpha' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Zoe Beta' })).toBeNull()

    await selectOption(user, 'Filter leads by progress', 'Intake pending')
    expect(screen.queryByRole('link', { name: 'Jane Alpha' })).toBeNull()
  })

  it('clear filters preserves lead sort order and visible-row selection', async () => {
    const user = userEvent.setup()
    render(<LeadsClient initialLeads={leadRows} esignEnabled />)

    await selectOption(user, 'Sort leads by', 'Name Z-A')
    await selectOption(user, 'Filter leads by practice area', 'Estate Planning')
    await user.click(screen.getByRole('checkbox', { name: 'Select all visible leads' }))
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))

    expect(visibleLeadNames()).toEqual(['Zoe Beta', 'Jane Alpha', 'Aaron Gamma'])
    expect(screen.getByText('2 selected')).toBeTruthy()
  })
})
