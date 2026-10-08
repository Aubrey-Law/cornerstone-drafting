// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MattersClient from '@/app/admin/matters/MattersClient'
import { MATTER_LIST_VIEW_KEY } from '@/lib/adminTables/matterTable'
import type { MatterListRow } from '@/lib/queries/matters'

const pushMock = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/admin/matters',
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

function matterRow(overrides: Partial<MatterListRow> & Pick<MatterListRow, 'matter_id'>): MatterListRow {
  return {
    matter_name: 'Estate Plan', matter_number: '2026-EP-001', stage: 'design', status: 'open', flags: null,
    matter_created: '2026-07-20T00:00:00Z', client_name: 'Client', client_email: 'client@example.com',
    client_phone: null, client_dob: null, client_address: null, spouse_name: null, spouse_email: null,
    spouse_phone: null, spouse_dob: null, spouse_address: null, plan_type: null, marital_status: null,
    has_minor_children: null, taxable_estate: null, intake_status: 'submitted', design_status: null,
    intake_submitted_at: '2026-07-20T00:00:00Z', drafts_sent_at: null, signing_date: null,
    documents_executed_at: null, next_appointment: null, next_appointment_type: null, referral_source: null,
    fee_amount: null, opened_at: null, practice_area: 'EP',
    ...overrides,
  } as MatterListRow
}

const matterRows: MatterListRow[] = [
  matterRow({ matter_id: 'zoe', client_name: 'Zoe Beta', stage: 'design', matter_number: '2026-EP-003' }),
  matterRow({ matter_id: 'aaron', client_name: 'Aaron Gamma', stage: 'intake', matter_number: '2026-PB-001', practice_area: 'Probate', intake_status: null }),
]

async function openBoard(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Board' }))
}

beforeEach(() => {
  pushMock.mockReset()
  window.localStorage.clear()
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    })),
  })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('matters list board view', () => {
  it('defaults to the table and switches to the stage board on request', async () => {
    const user = userEvent.setup()
    render(<MattersClient matters={matterRows} />)

    expect(screen.getByRole('table')).toBeTruthy()
    expect(screen.queryByRole('group', { name: 'Matters pipeline board' })).toBeNull()

    await openBoard(user)

    expect(screen.queryByRole('table')).toBeNull()
    const board = screen.getByRole('group', { name: 'Matters pipeline board' })
    expect(within(board).getAllByRole('region')).toHaveLength(5)
    expect(window.localStorage.getItem(MATTER_LIST_VIEW_KEY)).toBe('board')
  })

  it('places each matter in its stage group column', async () => {
    const user = userEvent.setup()
    render(<MattersClient matters={matterRows} />)
    await openBoard(user)

    const drafting = screen.getByRole('region', { name: 'Drafting · 1' })
    expect(within(drafting).getByText('Zoe Beta')).toBeTruthy()

    const preparation = screen.getByRole('region', { name: 'Design preparation · 1' })
    expect(within(preparation).getByText('Aaron Gamma')).toBeTruthy()
  })

  it('honours the active filters so both views show the same matters', async () => {
    const user = userEvent.setup()
    render(<MattersClient matters={matterRows} />)
    await openBoard(user)

    await user.type(screen.getByRole('searchbox', { name: 'Search matters' }), 'aaron')

    expect(screen.queryByText('Zoe Beta')).toBeNull()
    expect(screen.getByText('Aaron Gamma')).toBeTruthy()
  })

  it('persists a stage change made from a card and opens the matter on click', async () => {
    const user = userEvent.setup()
    render(<MattersClient matters={matterRows} />)
    await openBoard(user)

    await user.click(screen.getByRole('button', { name: 'Stage for Zoe Beta: Design' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Signing Scheduled' }))

    expect(fetch).toHaveBeenCalledWith(
      '/api/admin/matters/zoe/stage',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ stage: 'signing_scheduled' }) }),
    )

    await user.click(screen.getByRole('button', { name: /^Aaron Gamma/ }))
    expect(pushMock).toHaveBeenCalledWith('/admin/matters/aaron')
  })

  it('rolls the card back to its old column when the stage save fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'nope' }), { status: 500 })))
    const user = userEvent.setup()
    render(<MattersClient matters={matterRows} />)
    await openBoard(user)

    await user.click(screen.getByRole('button', { name: 'Stage for Zoe Beta: Design' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Signing Scheduled' }))

    expect((await screen.findByRole('alert')).textContent).toContain('nope')
    const drafting = screen.getByRole('region', { name: 'Drafting · 1' })
    expect(within(drafting).getByText('Zoe Beta')).toBeTruthy()
  })

  it('moves a dropped card into the target column', async () => {
    const user = userEvent.setup()
    render(<MattersClient matters={matterRows} />)
    await openBoard(user)

    fireEvent.drop(screen.getByRole('region', { name: 'Closed · 0' }), {
      dataTransfer: { getData: () => 'zoe' },
    })

    expect(fetch).toHaveBeenCalledWith(
      '/api/admin/matters/zoe/stage',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ stage: 'post_execution' }) }),
    )
  })

  it('clears table row selection when switching to the board', async () => {
    const user = userEvent.setup()
    render(<MattersClient matters={matterRows} />)

    await user.click(screen.getByRole('checkbox', { name: 'Select all visible matters' }))
    expect(screen.getByText('2 selected')).toBeTruthy()

    await openBoard(user)
    expect(screen.queryByText('2 selected')).toBeNull()
  })
  it('shows the same filtered matters as cards and remembers Grid', async () => {
    const user = userEvent.setup()
    render(<MattersClient matters={matterRows} />)
    await user.click(screen.getByRole('button', { name: 'Grid' }))
    const grid = screen.getByRole('list', { name: 'Matters grid' })
    expect(within(grid).getAllByRole('listitem')).toHaveLength(2)
    expect(within(grid).getByText('Zoe Beta')).toBeTruthy()
    expect(window.localStorage.getItem(MATTER_LIST_VIEW_KEY)).toBe('grid')
  })

})
