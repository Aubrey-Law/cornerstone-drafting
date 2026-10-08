// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'token' }))
import { MatterOverviewSidebar, overviewPeople } from '@/app/admin/matters/[id]/MatterOverviewSidebar'
import { EMPTY_PLAN_MIRROR } from '@/lib/matter/planMirror'
import type { PipelineMatter } from '@/types/database'
import type { MatterEstateSnapshot } from '@/lib/assets/matterEstateSnapshot'

const matter = {
  matter_id: 'm1', client_name: 'Daniel Whitfield', client_dob: '1961-03-14', client_email: 'dan@example.com', client_phone: '6175550148',
  marital_status: 'Married', spouse_name: 'Margaret Whitfield', spouse_dob: '1963-08-02', spouse_email: 'meg@example.com', spouse_phone: '6175550193',
} as PipelineMatter
const estate = { assetCount: 6, grossEstateEstimate: 2840000 } as MatterEstateSnapshot
const plan = { ...EMPTY_PLAN_MIRROR, trustName: 'Whitfield Family Trust', fiduciaries: [{ key: 'trustee_slots', role: 'Trustee', primary: 'Both', successor: 'Claire Whitfield' }] }

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ rows: [{ amountBilled: 225000, collected: 225000 }] }),
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function setup(overrides: Partial<PipelineMatter> = {}) {
  const onPeople = vi.fn()
  const onBilling = vi.fn()
  render(<MatterOverviewSidebar matter={{ ...matter, ...overrides }} details={{ flat_fee_amount: 4500, billing_type: 'flat_fee' }}
    plan={plan} estate={estate} onPeople={onPeople} onBilling={onBilling} tasks={<p>Task preview</p>} />)
  return { onPeople, onBilling }
}

it('renders a card per person with initials, role and DOB, email and phone', () => {
  setup()
  const client = screen.getByRole('region', { name: 'Client: Daniel Whitfield' })
  expect(client.textContent).toContain('DW')
  expect(client.textContent).toContain('Client · DOB 3/14/1961')
  expect(client.textContent).toContain('dan@example.com')
  const spouse = screen.getByRole('region', { name: 'Spouse: Margaret Whitfield' })
  expect(spouse.textContent).toContain('MW')
  expect(spouse.textContent).toContain('Spouse · DOB 8/2/1963')
  expect(spouse.textContent).toContain('meg@example.com')
})

it('does not show stale spouse details for an unmarried client', () => {
  expect(overviewPeople({ ...matter, marital_status: 'divorced' })).toHaveLength(1)
  setup({ marital_status: 'divorced' })
  expect(screen.queryByText('Margaret Whitfield')).toBeNull()
})

it('summarizes the plan and routes Edit to People', () => {
  const { onPeople } = setup()
  expect(screen.getByText('Whitfield Family Trust')).toBeTruthy()
  expect(screen.getByText('Trustees: Both → Claire Whitfield')).toBeTruthy()
  expect(screen.getByText('Gross estate $2,840,000 · 6 assets')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  expect(onPeople).toHaveBeenCalledOnce()
})

it('shows fee progress from the billing ledger and opens Billing', async () => {
  const { onBilling } = setup()
  await waitFor(() => expect(screen.getByText('$2,250 collected')).toBeTruthy())
  expect(screen.getByText('Balance $2,250')).toBeTruthy()
  expect(screen.getByRole('progressbar', { name: 'Share of the fee collected' }).getAttribute('aria-valuenow')).toBe('50')
  expect(fetch).toHaveBeenCalledWith('/api/admin/billing/matters/m1', expect.anything())
  fireEvent.click(screen.getByRole('button', { name: 'Fee — open billing' }))
  expect(onBilling).toHaveBeenCalledOnce()
})

it('keeps the opened and last-contact dates in the details panel', () => {
  setup({ opened_at: '2026-06-18T13:02:00.000Z' })
  expect(screen.queryByText('Opened')).toBeNull()
  expect(screen.queryByText('Last contact')).toBeNull()
})
