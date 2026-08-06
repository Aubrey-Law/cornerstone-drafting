// @vitest-environment jsdom

import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LeadsClient, type LeadRow } from '@/app/admin/leads/LeadsClient'
import MattersClient from '@/app/admin/matters/MattersClient'
import type { MatterListRow } from '@/lib/queries/matters'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/admin/leads',
  useSearchParams: () => new URLSearchParams(),
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
    .filter(link => link.getAttribute('href')?.startsWith('/admin/crm/opportunities/'))
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

const matterRows: MatterListRow[] = [
  {
    matter_id: 'zoe', matter_name: 'Zoe Estate Plan', matter_number: '2026-EP-003', stage: 'design', status: 'open', flags: null,
    matter_created: '2026-07-20T00:00:00Z', client_name: 'Zoe Beta', client_email: 'zoe@example.com', client_phone: '617-555-0101',
    client_dob: null, client_address: null, spouse_name: null, spouse_email: null, spouse_phone: null, spouse_dob: null, spouse_address: null,
    plan_type: null, marital_status: null, has_minor_children: null, taxable_estate: null, intake_status: 'submitted', design_status: null,
    intake_submitted_at: '2026-07-20T00:00:00Z', drafts_sent_at: null, signing_date: null, documents_executed_at: null,
    next_appointment: null, next_appointment_type: null, referral_source: null, fee_amount: null, opened_at: null, practice_area: 'EP',
  },
  {
    matter_id: 'jane', matter_name: 'Jane Estate Plan', matter_number: '2026-EP-002', stage: 'design', status: 'open', flags: null,
    matter_created: '2026-07-19T00:00:00Z', client_name: 'Jane Alpha', client_email: 'jane@example.com', client_phone: '617-555-0102',
    client_dob: null, client_address: null, spouse_name: null, spouse_email: null, spouse_phone: null, spouse_dob: null, spouse_address: null,
    plan_type: null, marital_status: null, has_minor_children: null, taxable_estate: null, intake_status: 'submitted', design_status: null,
    intake_submitted_at: '2026-07-19T00:00:00Z', drafts_sent_at: null, signing_date: null, documents_executed_at: null,
    next_appointment: null, next_appointment_type: null, referral_source: null, fee_amount: null, opened_at: null, practice_area: 'EP',
  },
  {
    matter_id: 'aaron', matter_name: 'Aaron Probate Matter', matter_number: '2026-PB-001', stage: 'intake', status: 'open', flags: null,
    matter_created: '2026-07-18T00:00:00Z', client_name: 'Aaron Gamma', client_email: 'aaron@example.com', client_phone: '617-555-0103',
    client_dob: null, client_address: null, spouse_name: null, spouse_email: null, spouse_phone: null, spouse_dob: null, spouse_address: null,
    plan_type: null, marital_status: null, has_minor_children: null, taxable_estate: null, intake_status: null, design_status: null,
    intake_submitted_at: null, drafts_sent_at: null, signing_date: null, documents_executed_at: null,
    next_appointment: null, next_appointment_type: null, referral_source: null, fee_amount: null, opened_at: null, practice_area: 'Probate',
  },
]

function visibleMatterNames(): string[] {
  return screen.getAllByRole('link')
    .filter(link => link.getAttribute('href')?.startsWith('/admin/matters/'))
    .map(link => link.textContent ?? '')
    .filter(Boolean)
}

describe('matter list controls', () => {
  it('sorts the filtered matter rows from the Sort by control', async () => {
    const user = userEvent.setup()
    render(<MattersClient matters={matterRows} />)

    await selectOption(user, 'Sort matters by', 'Client Z-A')
    expect(visibleMatterNames()).toEqual(['Zoe Beta', 'Jane Alpha', 'Aaron Gamma'])
  })

  it('clear filters preserves matter sort order and visible-row selection', async () => {
    const user = userEvent.setup()
    render(<MattersClient matters={matterRows} />)

    await selectOption(user, 'Sort matters by', 'Client Z-A')
    await selectOption(user, 'Filter by practice area', 'Estate Planning')
    await user.click(screen.getByRole('checkbox', { name: 'Select all visible matters' }))
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))

    expect(visibleMatterNames()).toEqual(['Zoe Beta', 'Jane Alpha', 'Aaron Gamma'])
    expect(screen.getByText('2 selected')).toBeTruthy()
  })
})
