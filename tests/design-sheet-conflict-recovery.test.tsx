// @vitest-environment jsdom
import { act, renderHook, waitFor, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/app/admin/drafting/[matterId]/design/actions', () => ({ saveLiDesignSheet: vi.fn(), updatePlanCoverage: vi.fn() }))
import { useDesignSheetState } from '@/lib/designSheet/useDesignSheetState'
import { clearDesignSheetDraft, readDesignSheetDraft, writeDesignSheetDraft } from '@/lib/designSheet/designSheetDraft'
import { compareDesignSheets } from '@/lib/designSheet/designSheetConflict'
import { inflateDesignSheetRow } from '@/lib/designSheetPersistence'
import type { PipelineMatter } from '@/types/database'
const base = inflateDesignSheetRow({ id: 's', matter_id: 'm', client_name: 'Base', updated_at: '2026-09-01T00:00:00Z', decisions: {} })!
const latest = { ...base, client_name: 'Server', updated_at: '2026-09-02T00:00:00Z' }
const args = { matterId: 'm', matter: { id: 'm', practice_area: 'EP' } as unknown as PipelineMatter, contacts: [], sheet: base, lpData: null }
const response = (status: number, data: unknown) => ({ status, ok: status === 200, json: async () => data })
afterEach(() => { cleanup(); clearDesignSheetDraft('m'); vi.unstubAllGlobals() })
describe('conflict recovery lifecycle', () => {
  it('pauses without a retry, preserves recovery across reload, and saves explicit choices against latest stamp', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(409, { conflict: true, updated_at: latest.updated_at })).mockResolvedValueOnce(response(200, { sheet: latest }))
    vi.stubGlobal('fetch', fetcher)
    const first = renderHook(() => useDesignSheetState(args))
    act(() => first.result.current.updateField('client_name', 'Local'))
    await act(async () => { await first.result.current.persistSheet() })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(first.result.current.conflict?.local.client_name).toBe('Local')
    act(() => first.result.current.updateField('client_name', 'Blocked edit'))
    expect(first.result.current.sheet.client_name).toBe('Local')
    await act(async () => { await first.result.current.persistSheet() })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(readDesignSheetDraft('m')?.conflict).toBeTruthy()
    first.unmount()
    const restored = renderHook(() => useDesignSheetState({ ...args, sheet: latest }))
    expect(restored.result.current.conflict?.local.client_name).toBe('Local')
    fetcher.mockResolvedValueOnce(response(200, { id: 's', updated_at: '2026-09-03T00:00:00Z' }))
    const choices = Object.fromEntries(compareDesignSheets(restored.result.current.conflict!.local, latest).map(d => [d.path, 'local'])) as Record<string, 'local'>
    await act(async () => { await restored.result.current.resolveConflict(choices) })
    expect(JSON.parse(fetcher.mock.calls[2][1].body).expectedUpdatedAt).toBe(latest.updated_at)
    expect(restored.result.current.conflict).toBeNull()
    expect(restored.result.current.saveStatus).toBe('saved')
  })
  it('retains both copies on failure and reopens comparison on a repeated conflict', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(409, { conflict: true })).mockResolvedValueOnce(response(200, { sheet: latest }))
    vi.stubGlobal('fetch', fetcher)
    const { result } = renderHook(() => useDesignSheetState(args))
    act(() => result.current.updateField('client_name', 'Local'))
    await act(async () => { await result.current.persistSheet() })
    const choices = Object.fromEntries(compareDesignSheets(result.current.conflict!.local, latest).map(d => [d.path, 'local'])) as Record<string, 'local'>
    fetcher.mockRejectedValueOnce(new Error('offline'))
    await act(async () => { await result.current.resolveConflict(choices) })
    expect(result.current.conflict?.local.client_name).toBe('Local')
    expect(result.current.conflict?.latest?.client_name).toBe('Server')
    fetcher.mockResolvedValueOnce(response(409, { conflict: true })).mockResolvedValueOnce(response(200, { sheet: { ...latest, client_name: 'Newest' } }))
    await act(async () => { await result.current.resolveConflict(choices) })
    await waitFor(() => expect(result.current.conflict?.latest?.client_name).toBe('Newest'))
    expect(result.current.conflict?.local.client_name).toBe('Local')
  })
  it('keeps local recovery when latest-version loading fails and can retry the read', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(409, { conflict: true })).mockRejectedValueOnce(new Error('offline'))
    vi.stubGlobal('fetch', fetcher)
    const { result } = renderHook(() => useDesignSheetState(args))
    act(() => result.current.updateField('client_name', 'Local'))
    await act(async () => { await result.current.persistSheet() })
    expect(result.current.conflict?.local.client_name).toBe('Local')
    expect(result.current.conflict?.latest).toBeNull()
    expect(result.current.conflict?.error).toContain('preserved')
    fetcher.mockResolvedValueOnce(response(200, { sheet: latest }))
    await act(async () => { await result.current.reloadConflictLatest() })
    expect(result.current.conflict?.latest?.client_name).toBe('Server')
    expect(fetcher.mock.calls.filter(call => call[1]?.method === 'PATCH')).toHaveLength(1)
  })

  it('surfaces legacy stale drafts without automatically writing them over newer props', async () => {
    writeDesignSheetDraft({ matterId: 'm', sheet: { ...base, client_name: 'Legacy local' }, baseUpdatedAt: base.updated_at ?? null })
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const { result } = renderHook(() => useDesignSheetState({ ...args, sheet: latest }))
    expect(result.current.conflict?.local.client_name).toBe('Legacy local')
    expect(result.current.conflict?.latest?.client_name).toBe('Server')
    await act(async () => { await result.current.persistSheet() })
    expect(fetcher).not.toHaveBeenCalled()
    expect(readDesignSheetDraft('m')?.sheet.client_name).toBe('Legacy local')
  })

  it.each(['success', 'failure'])('ignores a late recovery read %s after a successful resolution', async outcome => {
    writeDesignSheetDraft({ matterId: 'm', sheet: { ...base, client_name: 'Local' }, baseUpdatedAt: base.updated_at ?? null })
    let completeRead!: (value: ReturnType<typeof response>) => void
    let failRead!: (error: Error) => void
    const delayed = new Promise<ReturnType<typeof response>>((resolve, reject) => { completeRead = resolve; failRead = reject })
    const fetcher = vi.fn().mockReturnValueOnce(delayed).mockResolvedValueOnce(response(200, { id: 's', updated_at: '2026-09-03T00:00:00Z' }))
    vi.stubGlobal('fetch', fetcher)
    const { result } = renderHook(() => useDesignSheetState({ ...args, sheet: latest }))
    let pendingRead!: Promise<void>
    act(() => { pendingRead = result.current.reloadConflictLatest() })
    const choices = Object.fromEntries(compareDesignSheets(result.current.conflict!.local, latest).map(d => [d.path, 'local'])) as Record<string, 'local'>
    await act(async () => { expect(await result.current.resolveConflict(choices)).toBe(true) })
    await act(async () => {
      if (outcome === 'success') completeRead(response(200, { sheet: { ...latest, client_name: 'Stale read' } }))
      else failRead(new Error('late failure'))
      await pendingRead
    })
    expect(result.current.conflict).toBeNull()
    expect(result.current.saveStatus).toBe('saved')
    expect(readDesignSheetDraft('m')?.conflict).toBeFalsy()
    expect(readDesignSheetDraft('m')?.sheet.client_name).toBe('Local')
  })

  it('keeps the newest recovery read when overlapping requests finish out of order', async () => {
    writeDesignSheetDraft({ matterId: 'm', sheet: { ...base, client_name: 'Local' }, baseUpdatedAt: base.updated_at ?? null })
    let completeOlderRead!: (value: ReturnType<typeof response>) => void
    const olderRead = new Promise<ReturnType<typeof response>>(resolve => { completeOlderRead = resolve })
    const newest = { ...latest, client_name: 'Newest saved', updated_at: '2026-09-03T00:00:00Z' }
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(olderRead).mockResolvedValueOnce(response(200, { sheet: newest })))
    const { result } = renderHook(() => useDesignSheetState({ ...args, sheet: latest }))
    let pendingRead!: Promise<void>
    act(() => { pendingRead = result.current.reloadConflictLatest() })
    await act(async () => { await result.current.reloadConflictLatest() })
    await act(async () => { completeOlderRead(response(200, { sheet: latest })); await pendingRead })
    expect(result.current.conflict?.latest?.client_name).toBe('Newest saved')
    expect(readDesignSheetDraft('m')?.conflict?.latest?.client_name).toBe('Newest saved')
  })

})
