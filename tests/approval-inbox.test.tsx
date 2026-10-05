// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ApprovalInbox } from '@/app/admin/components/ApprovalInbox'

const proposal = {
  id: 'proposal-1',
  action_key: 'communication.send',
  risk: 'external_write',
  display_summary: 'Send the prepared intake reminder',
  confirmation_policy: 'explicit' as const,
  created_at: '2026-10-02T14:00:00.000Z',
  source: 'automation',
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ApprovalInbox', () => {
  it('requires an exact preview before confirming an external action', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        proposal,
        preview: { display: { recipient: 'client@example.com', channel: 'email', content: 'Please complete your intake.' } },
        confirmation: { policy: 'explicit', digest: 'fresh-preview', stale: false },
      }))
      .mockResolvedValueOnce(Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    render(<ApprovalInbox initialProposals={[proposal]} />)

    expect(screen.getByText(/prepared by automation/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /review exact change/i }))
    expect(await screen.findByText('client@example.com')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /confirm this exact send/i }))
    await waitFor(() => expect(screen.getByText(/Action completed and recorded/)).toBeTruthy())
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/admin/actions/proposals/proposal-1')
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/admin/actions/proposals/proposal-1/execute', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ confirmationDigest: 'fresh-preview' }),
    }))
  })

  it('refreshes the host after a rejected action without executing it', async () => {
    const onResolved = vi.fn()
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    render(<ApprovalInbox initialProposals={[proposal]} onResolved={onResolved} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))

    await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/actions/proposals/proposal-1', expect.objectContaining({ method: 'PATCH' }))
    // The inbox removes the row inside a transition after calling onResolved,
    // so the empty state can land a tick later than the callback.
    expect(await screen.findByText(/No actions are waiting/)).toBeTruthy()
  })
})
