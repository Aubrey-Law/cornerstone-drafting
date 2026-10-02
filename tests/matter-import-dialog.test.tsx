// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }))
vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'token' }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

import ImportExistingMatterDialog from '@/app/admin/matters/ImportExistingMatterDialog'

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ matterId: 'm1', created: true, warnings: [] }) })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Bring in an existing matter', () => {
  it('defaults to a closed matter with no plan, and opens its documents afterwards', async () => {
    render(<ImportExistingMatterDialog open onOpenChange={() => {}} />)

    fireEvent.change(screen.getByLabelText('Client name'), { target: { value: 'Margaret Whitfield' } })
    fireEvent.change(screen.getByLabelText('Client email'), { target: { value: 'mw@example.com' } })
    fireEvent.change(screen.getByLabelText('Documents signed (optional)'), { target: { value: '2023-05-10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Import matter' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/admin/matters/import')
    expect(JSON.parse(init.body)).toMatchObject({
      clientName: 'Margaret Whitfield',
      stage: 'closed',
      plan: 'none',
      dates: { signedOn: '2023-05-10' },
    })
    await waitFor(() => expect(push).toHaveBeenCalledWith('/admin/matters/m1?tab=documents'))
  })

  it('does not offer a plan for a closed matter', () => {
    render(<ImportExistingMatterDialog open onOpenChange={() => {}} />)
    expect(screen.getByRole('radio', { name: /Plan the remaining work/ })).toHaveProperty('disabled', true)
  })
})
