// @vitest-environment jsdom

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))
vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'access-token' }))

import { TimeEntriesCard } from '@/app/admin/matters/[id]/tabs/TimeEntriesCard'

const MATTER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const BASE = `/api/admin/matters/${MATTER_ID}/time-entries`

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const summary = {
  entries: [{ id: 'e1', matterId: MATTER_ID, userId: null, workDate: '2026-10-05', minutes: 90, description: 'Design meeting', source: 'suggested', activityIds: [], createdAt: '' }],
  totalMinutes: 90,
  timer: null,
  timerElsewhere: null,
  unavailable: false,
}

describe('TimeEntriesCard', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === BASE && (!init?.method || init.method === 'GET')) return json(summary)
      if (url === `${BASE}/timer` && init?.method === 'POST') return json({ timer: { userId: 'u', matterId: MATTER_ID, startedAt: new Date().toISOString(), description: null }, stopped: null })
      if (url === BASE && init?.method === 'POST') return json({ entry: summary.entries[0] }, 201)
      return json({ error: 'unexpected' }, 500)
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('shows the total and the entries', async () => {
    render(<TimeEntriesCard matterId={MATTER_ID} />)
    expect(await screen.findByText('Design meeting')).toBeTruthy()
    expect(screen.getByText(/1\.5 h recorded/)).toBeTruthy()
    expect(screen.getByText('suggested')).toBeTruthy()
  })

  it('starts a timer', async () => {
    render(<TimeEntriesCard matterId={MATTER_ID} />)
    await screen.findByText('Design meeting')
    await userEvent.click(screen.getByRole('button', { name: /Start timer/ }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => url === `${BASE}/timer` && init?.method === 'POST')).toBe(true))
  })

  it('logs typed time in minutes', async () => {
    render(<TimeEntriesCard matterId={MATTER_ID} />)
    await screen.findByText('Design meeting')
    await userEvent.click(screen.getByRole('button', { name: /Add time/ }))
    await userEvent.type(screen.getByLabelText('Time'), '1:30')
    await userEvent.type(screen.getByLabelText('What was done'), 'Reviewed the deed')
    await userEvent.click(screen.getByRole('button', { name: /Log 1\.5 h/ }))
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, init]) => url === BASE && init?.method === 'POST')
      expect(call).toBeTruthy()
      expect(JSON.parse(String(call![1]!.body))).toMatchObject({ minutes: 90, description: 'Reviewed the deed' })
    })
  })

  it('says when the migration has not run', async () => {
    fetchMock.mockImplementation(async () => json({ ...summary, entries: [], totalMinutes: 0, unavailable: true }))
    render(<TimeEntriesCard matterId={MATTER_ID} />)
    expect(await screen.findByText(/next database update/)).toBeTruthy()
  })
})
