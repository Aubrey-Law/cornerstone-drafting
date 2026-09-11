// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'token' }))
import { LeadLogCallDialog } from '@/components/leads/LeadLogCallDialog'
const fetchMock = vi.fn()
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks() })
const saved = { id: 'call-1', created_at: '2026-09-11T12:00:00Z' }
function response(ok: boolean, data: unknown) { return Promise.resolve({ ok, json: async () => data }) }
describe('Call outcome logging', () => {
  it('persists a call outcome without placing a call, then creates the requested follow-up', async () => {
    vi.stubGlobal('fetch', fetchMock.mockImplementationOnce(() => response(true, { activity: saved })).mockImplementationOnce(() => response(true, { task: { id: 'task' } })))
    const onSaved = vi.fn()
    render(<LeadLogCallDialog leadId="lead-1" open onOpenChange={vi.fn()} onSaved={onSaved} />)
    fireEvent.change(screen.getByLabelText('Call outcome'), { target: { value: 'voicemail' } })
    fireEvent.change(screen.getByLabelText('Call notes'), { target: { value: 'Asked client to return call' } })
    fireEvent.change(screen.getByLabelText('Next follow-up'), { target: { value: '2026-09-14T10:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save call' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved.created_at, false))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/leads/lead-1/activity')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ eventType: 'call_logged', outcome: 'voicemail', detail: 'Asked client to return call' })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ lead_id: 'lead-1', due_at: new Date('2026-09-14T10:00').toISOString(), source: 'manual' })
  })
  it('does not report success or create a task when the call fails', async () => {
    vi.stubGlobal('fetch', fetchMock.mockImplementation(() => response(false, { error: 'Save failed' })))
    const onSaved = vi.fn()
    render(<LeadLogCallDialog leadId="lead-1" open onOpenChange={vi.fn()} onSaved={onSaved} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save call' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Save failed')
    expect(onSaved).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('retries only the follow-up after a partial save', async () => {
    vi.stubGlobal('fetch', fetchMock.mockImplementationOnce(() => response(true, { activity: saved })).mockImplementationOnce(() => response(false, { error: 'Task failed' })).mockImplementationOnce(() => response(true, { task: { id: 'task' } })))
    const onSaved = vi.fn()
    render(<LeadLogCallDialog leadId="lead-1" open onOpenChange={vi.fn()} onSaved={onSaved} />)
    fireEvent.change(screen.getByLabelText('Next follow-up'), { target: { value: '2026-09-14T10:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save call' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Call saved. Follow-up was not saved.')
    expect(onSaved).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Save follow-up' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual(['/api/admin/leads/lead-1/activity', '/api/admin/tasks', '/api/admin/tasks'])
  })
})
