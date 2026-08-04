// @vitest-environment jsdom

import React from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/sidebarCountsClient', () => ({ invalidateSidebarCountsClient: vi.fn() }))

import { CallsPageClient, type AdminCallRow } from '@/app/admin/calls/CallsPageClient'

const CALLS: AdminCallRow[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    direction: 'inbound',
    status: 'completed',
    participant_number: '+16175550101',
    started_at: '2026-08-01T15:00:00.000Z',
    duration_seconds: 65,
    recording_url: null,
    voicemail_url: null,
    summary: null,
    firm_user_email: null,
    matter_id: null,
    lead_id: null,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    direction: 'outbound',
    status: 'completed',
    participant_number: '+16175550102',
    started_at: '2026-08-01T16:00:00.000Z',
    duration_seconds: 30,
    recording_url: null,
    voicemail_url: null,
    summary: null,
    firm_user_email: null,
    matter_id: null,
    lead_id: null,
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ deleted: 2 }),
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Calls bulk delete', () => {
  it('has no selection bar until something is selected', () => {
    render(<CallsPageClient initialCalls={CALLS} filter="all" />)

    expect(screen.queryByRole('button', { name: /delete selected/i })).toBeNull()
  })

  it('selects every call and deletes them in one request', async () => {
    const user = userEvent.setup()
    render(<CallsPageClient initialCalls={CALLS} filter="all" />)

    await user.click(screen.getByRole('checkbox', { name: /select all calls/i }))
    expect(screen.getByText('2 selected')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /delete selected/i }))
    await user.click(screen.getByRole('button', { name: /^delete 2 calls$/i }))

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('/api/admin/calls/bulk-delete')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      ids: [CALLS[0].id, CALLS[1].id],
    })
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it('counts a single selected call', async () => {
    const user = userEvent.setup()
    render(<CallsPageClient initialCalls={CALLS} filter="all" />)

    await user.click(screen.getAllByRole('checkbox', { name: /^select call from/i })[0])

    expect(screen.getByText('1 selected')).toBeTruthy()
  })
})
