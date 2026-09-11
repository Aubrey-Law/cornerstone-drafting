// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'synthetic' }))
import { useRecordTaskCounts } from '@/components/tasks/useRecordTaskCounts'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('refreshes aggregates without downloading task rows', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ counts: { open: 603, overdue: 301 } }) })
  vi.stubGlobal('fetch', fetch)
  const { result } = renderHook(() => useRecordTaskCounts('record', { open: 1, overdue: 0 }))
  await act(() => result.current.refresh())
  expect(result.current.open).toBe(603)
  expect(fetch.mock.calls[0][0]).toBe('/api/admin/tasks/counts?recordId=record')
})
it('keeps the last good count and reports failed refreshes', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
  const { result } = renderHook(() => useRecordTaskCounts('record', { open: 603, overdue: 301 }))
  await act(() => result.current.refresh())
  expect(result.current.open).toBe(603)
  expect(result.current.error).toBeTruthy()
})
it('does not apply a late refresh from the previous record', async () => {
  let resolve!: (response: unknown) => void
  vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(done => { resolve = done })))
  const { result, rerender } = renderHook(({ id }) => useRecordTaskCounts(id, { open: id === 'one' ? 3 : 7, overdue: 0 }), { initialProps: { id: 'one' } })
  let pending!: Promise<void>
  act(() => { pending = result.current.refresh() })
  rerender({ id: 'two' })
  await act(async () => { resolve({ ok: true, json: async () => ({ counts: { open: 100, overdue: 100 } }) }); await pending })
  expect(result.current.open).toBe(7)
})
