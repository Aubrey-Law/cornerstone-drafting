// @vitest-environment jsdom
import { cleanup, renderHook, waitFor, act } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }))
vi.mock('@/lib/clientApi', () => ({ apiRequest }))
vi.mock('@/lib/messages/useMessagesRealtime', () => ({ useMessagesRealtime: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
import { useMatterCommunications } from '@/app/admin/matters/[id]/useMatterCommunications'
const message = { id: '11111111-1111-4111-8111-111111111111', sender_role: 'client', read_at: null, body: 'Synthetic', created_at: '2026-09-10T12:00:00Z' }
beforeEach(() => {
  apiRequest.mockReset().mockImplementation(async (url: string, options?: RequestInit) => {
    if (url.includes('summary=1')) return { latest: message, unread: 4 }
    if (options?.method === 'PATCH') return { ok: true }
    if (url.includes('sms-messages')) return []
    return [message]
  })
})
afterEach(cleanup)
it('fetches only an unread summary on Overview, then loads and acknowledges displayed history on activation', async () => {
  const { result, rerender } = renderHook(({ enabled }) => useMatterCommunications({ matterId: 'matter-1', token: 'synthetic', initialEmailTo: '', enabled }), { initialProps: { enabled: false } })
  await waitFor(() => expect(result.current.unreadPortalCount).toBe(4))
  expect(apiRequest).toHaveBeenCalledTimes(1)
  expect(apiRequest.mock.calls[0][0]).toContain('summary=1')
  rerender({ enabled: true })
  await waitFor(() => expect(apiRequest.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(true))
  const patch = apiRequest.mock.calls.find(([, options]) => options?.method === 'PATCH')!
  expect(JSON.parse(patch[1].body)).toEqual({ matter_id: 'matter-1', message_ids: [message.id] })
  await waitFor(() => expect(result.current.portalMessages[0].read_at).toBeTruthy())
  const reads = apiRequest.mock.calls.length
  rerender({ enabled: false }); rerender({ enabled: true })
  expect(apiRequest.mock.calls.length).toBe(reads)
})
it('keeps failed history distinct from an empty conversation and supports retry', async () => {
  apiRequest.mockImplementation(async (url: string) => { if (url.includes('summary=1')) return { latest: null, unread: 0 }; throw new Error('offline') })
  const { result } = renderHook(() => useMatterCommunications({ matterId: 'matter-1', token: 'synthetic', initialEmailTo: '' }))
  await waitFor(() => expect(result.current.readError).toBeTruthy())
  apiRequest.mockResolvedValue([])
  await act(() => result.current.retry())
  expect(result.current.readError).toBeNull()
})
it('never sends through the retired SMS channel', async () => {
  const { result } = renderHook(() => useMatterCommunications({ matterId: 'matter-1', token: 'synthetic', initialEmailTo: '', enabled: false }))
  await act(async () => { expect(await result.current.sendOnChannel('sms', 'Old draft')).toBe(false) })
  expect(apiRequest.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
})
