// @vitest-environment jsdom

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { getSession } = vi.hoisted(() => ({
  getSession: vi.fn(async () => ({ data: { session: { access_token: 'token-1' } } })),
}))
vi.mock('@/lib/supabaseClient', () => ({ supabase: { auth: { getSession } } }))

import { ChatMessage } from '@/app/admin/components/ChatMessage'

/**
 * What the attorney sees when the assistant exports leads: how many matched,
 * and a download that carries their session — the CSV route is admin-only.
 */

function messageWith(toolEvent: Record<string, unknown>, tool = 'export_leads') {
  return {
    id: 'm1',
    role: 'assistant' as const,
    content: 'Here are your open leads.',
    timestamp: '2026-08-30T12:00:00Z',
    toolEvents: [{ toolUseId: 't1', tool, status: 'done' as const, ...toolEvent }],
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('the lead export chat card', () => {
  it('reports how many leads the export holds', () => {
    render(<ChatMessage message={messageWith({ exportCount: 12, downloadUrl: '/api/admin/leads/export?status=open' })} />)
    expect(screen.getByText('Lead export ready')).toBeTruthy()
    expect(screen.getByText(/12 leads — name, email and phone/)).toBeTruthy()
  })

  it('names matters as matters when the matter export ran', () => {
    render(<ChatMessage message={messageWith(
      { exportCount: 1, downloadUrl: '/api/admin/matters/export' },
      'export_matters',
    )} />)
    expect(screen.getByText('Matter export ready')).toBeTruthy()
    // Singular, so a one-row export does not read "1 matters".
    expect(screen.getByText(/^1 matter —/)).toBeTruthy()
  })

  it('downloads the CSV with the admin session token rather than a bare link', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['Name,Email,Phone'], { type: 'text/csv' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    URL.createObjectURL = vi.fn(() => 'blob:leads')
    URL.revokeObjectURL = vi.fn()

    render(<ChatMessage message={messageWith({
      exportCount: 1,
      filename: 'cornerstone-leads-open-2026-08-30.csv',
      downloadUrl: '/api/admin/leads/export?status=open',
    })} />)
    await userEvent.click(screen.getByRole('button', { name: /Download CSV/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/leads/export?status=open',
      { headers: { Authorization: 'Bearer token-1' } },
    )
    vi.unstubAllGlobals()
  })

  it('says so when the export failed instead of offering a broken download', () => {
    render(<ChatMessage message={{
      ...messageWith({}),
      toolEvents: [{ toolUseId: 't1', tool: 'export_leads', status: 'error' as const, error: 'view missing' }],
    }} />)
    expect(screen.getByText(/Lead export failed: view missing/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Download CSV/ })).toBeNull()
  })
})
