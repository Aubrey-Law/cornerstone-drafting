// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAutoSave } from '@/hooks/useAutoSave'

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: { access_token: 'test-token' } },
      })),
    },
  },
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

/**
 * The client intake save path had no test coverage at all, which is how the
 * "reports Saved while the answer is still only in memory" behaviour survived.
 */
describe('useAutoSave', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    // Unmount between cases: the hook registers window/document listeners, and
    // leaving previous instances mounted lets their pending saves respond to a
    // later test's pagehide on the shared jsdom window.
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('reports unsaved changes while the debounce is pending, not "saved"', () => {
    const { result } = renderHook(() => useAutoSave('intake-1', 1500))

    expect(result.current.status).toBe('idle')

    act(() => {
      result.current.debouncedSave({ first_name: 'Ada' })
    })

    // Previously this stayed 'idle', which the intake UI renders as "Saved" —
    // telling the client their answer was stored when nothing had been sent.
    expect(result.current.status).toBe('dirty')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends the debounced payload once the delay elapses', async () => {
    const { result } = renderHook(() => useAutoSave('intake-1', 1500))

    act(() => {
      result.current.debouncedSave({ first_name: 'Ada' })
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600)
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/intake')
    expect(JSON.parse(init.body as string)).toMatchObject({
      first_name: 'Ada',
      existingId: 'intake-1',
    })
    expect(result.current.status).toBe('saved')
  })

  it('flushes a pending answer on pagehide instead of losing it', async () => {
    const { result } = renderHook(() => useAutoSave('intake-1', 1500))

    act(() => {
      result.current.debouncedSave({ first_name: 'Grace' })
    })
    expect(fetchMock).not.toHaveBeenCalled()

    // A client typing an answer and immediately closing the tab (or
    // backgrounding the browser on mobile) used to lose it entirely.
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'))
      await Promise.resolve()
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit & { keepalive?: boolean }]
    // keepalive lets the request outlive the page being torn down.
    expect(init.keepalive).toBe(true)
    expect(JSON.parse(init.body as string)).toMatchObject({ first_name: 'Grace' })
  })

  it('does not re-send anything on pagehide when there is nothing pending', async () => {
    const { result } = renderHook(() => useAutoSave('intake-1', 1500))

    act(() => {
      result.current.debouncedSave({ first_name: 'Ada' })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      window.dispatchEvent(new Event('pagehide'))
      await Promise.resolve()
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps the pending snapshot when a save fails so flush() can retry', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, json: async () => ({ error: 'boom' }) }))
    const { result } = renderHook(() => useAutoSave('intake-1', 1500))

    act(() => {
      result.current.debouncedSave({ first_name: 'Ada' })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600)
    })

    expect(result.current.status).toBe('error')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // The pre-submit flush must retry rather than report success for data that
    // never reached the server.
    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({}) }))
    await act(async () => {
      await result.current.flush()
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('drains an older running debounce request before flushing a newer snapshot', async () => {
    let finishOlder!: () => void
    let storedName = ''
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      if (body.first_name === 'Older') await new Promise<void>((resolve) => { finishOlder = resolve })
      storedName = body.first_name
      return { ok: true, json: async () => ({}) }
    })
    const { result } = renderHook(() => useAutoSave('intake-1', 1500))
    act(() => result.current.debouncedSave({ first_name: 'Older' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    act(() => result.current.debouncedSave({ first_name: 'Latest' }))
    let flushed = false
    let pending!: Promise<boolean>
    await act(async () => {
      pending = result.current.flush().then((ok) => { flushed = true; return ok })
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(flushed).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => { finishOlder(); expect(await pending).toBe(true) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(storedName).toBe('Latest')
    await act(async () => { await vi.advanceTimersByTimeAsync(1600) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retains a failed explicit flush snapshot for retry', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'offline' }) })
    const { result } = renderHook(() => useAutoSave('intake-1'))
    act(() => result.current.trackForFlush({ first_name: 'Ada' }))
    await act(async () => { expect(await result.current.flush()).toBe(false) })
    await act(async () => { expect(await result.current.flush()).toBe(true) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String(fetchMock.mock.calls[1][1].body)).first_name).toBe('Ada')
  })

  it.each([
    ['pagehide', undefined], ['pagehide', 'invite-1'],
    ['visibilitychange', undefined], ['visibilitychange', 'invite-1'],
  ] as const)('dispatches latest keepalive immediately on %s with token %s while an older request is unresolved', async (event, publicToken) => {
    let finishOlder!: () => void
    let storedName = ''
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      if (body.first_name === 'Older') await new Promise<void>((resolve) => { finishOlder = resolve })
      storedName = body.first_name
      return { ok: true, json: async () => ({}) }
    })
    const { result } = renderHook(() => useAutoSave('intake-1', 1500, publicToken))
    act(() => result.current.debouncedSave({ first_name: 'Older' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    act(() => result.current.debouncedSave({ first_name: 'Latest' }))
    if (event === 'visibilitychange') vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    act(() => {
      (event === 'pagehide' ? window : document).dispatchEvent(new Event(event))
      // Dispatch must happen in the event handler, without awaiting the older
      // request (or another session lookup), before the page can be discarded.
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
    const keepalive = fetchMock.mock.calls[1][1] as RequestInit
    expect(keepalive.keepalive).toBe(true)
    expect(JSON.parse(String(keepalive.body))).toMatchObject({ first_name: 'Latest', existingId: 'intake-1' })
    expect(keepalive.headers).toMatchObject(publicToken ? { 'X-Intake-Token': 'invite-1' } : { Authorization: 'Bearer test-token' })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(storedName).toBe('Latest')
    expect(result.current.status).toBe('dirty')
    let flushed = false
    let flushing!: Promise<boolean>
    await act(async () => {
      flushing = result.current.flush().then((ok) => { flushed = true; return ok })
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(flushed).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // If this page resumes, the older write can still land after keepalive.
    // Flush must repair that ordering before ordinary submit can proceed.
    await act(async () => { finishOlder(); expect(await flushing).toBe(true) })
    expect(storedName).toBe('Latest')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[2][1].keepalive).not.toBe(true)
  })
})
