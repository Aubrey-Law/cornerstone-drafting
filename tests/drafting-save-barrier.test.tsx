// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/app/admin/drafting/[matterId]/design/actions', () => ({ saveLiDesignSheet: vi.fn(), updatePlanCoverage: vi.fn() }))
import { useDesignSheetState } from '@/lib/designSheet/useDesignSheetState'
import { saveLiDesignSheet, updatePlanCoverage } from '@/app/admin/drafting/[matterId]/design/actions'
import { inflateDesignSheetRow } from '@/lib/designSheetPersistence'
import { clearDesignSheetDraft } from '@/lib/designSheet/designSheetDraft'
import type { PipelineMatter } from '@/types/database'
const sheet = inflateDesignSheetRow({ id: 's', matter_id: 'm', client_name: 'Before', updated_at: '2026-09-01T00:00:00Z', decisions: {} })!
const args = { matterId: 'm', matter: { matter_id: 'm', practice_area: 'EP' } as PipelineMatter, contacts: [], sheet, lpData: null }
const response = (status = 200) => ({ status, ok: status === 200, json: async () => status === 200 ? { id: 's', updated_at: '2026-09-11T12:00:00Z' } : { conflict: true } })
afterEach(() => { cleanup(); clearDesignSheetDraft('m'); vi.unstubAllGlobals(); vi.clearAllMocks() })
describe('save barrier before drafting', () => {
  it('saves dirty fields immediately without waiting for autosave', async () => {
    const fetcher = vi.fn().mockResolvedValue(response())
    vi.stubGlobal('fetch', fetcher)
    const { result } = renderHook(() => useDesignSheetState(args))
    act(() => result.current.updateField('client_name', 'After'))
    await act(async () => { expect(await result.current.flushAndSave()).toBe(true) })
    expect(JSON.parse(fetcher.mock.calls[0][1].body).sheet.client_name).toBe('After')
    expect(result.current.saveStatus).toBe('saved')
  })
  it('waits for an in-flight save and also saves changes made while it was running', async () => {
    let resolve!: (r: ReturnType<typeof response>) => void
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise(r => { resolve = r })).mockResolvedValue(response())
    vi.stubGlobal('fetch', fetcher)
    const { result } = renderHook(() => useDesignSheetState(args))
    act(() => result.current.updateField('client_name', 'First'))
    let save!: Promise<boolean>
    await act(async () => { save = result.current.persistSheet() })
    act(() => result.current.updateField('client_name', 'Second'))
    let barrier!: Promise<boolean>
    let done = false
    await act(async () => { barrier = result.current.flushAndSave().then(v => { done = true; return v }) })
    expect(done).toBe(false)
    await act(async () => { resolve(response()); await save; expect(await barrier).toBe(true) })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetcher.mock.calls[1][1].body).sheet.client_name).toBe('Second')
  })
  it('does not allow drafting past a save conflict', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(409)))
    const { result } = renderHook(() => useDesignSheetState(args))
    act(() => result.current.updateField('client_name', 'Local'))
    await act(async () => { expect(await result.current.flushAndSave()).toBe(false) })
    expect(result.current.conflict).toBeTruthy()
  })
  it('serializes LP edits, retaining both patches, and waits for coverage before drafting', async () => {
    let finish!: () => void
    vi.mocked(saveLiDesignSheet).mockImplementationOnce(() => new Promise<void>(r => { finish = r })).mockResolvedValue(undefined)
    vi.mocked(updatePlanCoverage).mockResolvedValue(undefined)
    const { result } = renderHook(() => useDesignSheetState({ ...args, lpData: { li_design_sheet_data: {}, li_plan_coverage: 'no_trust', li_design_sheet_approved: false } }))
    await act(async () => { result.current.updateLpPatch({ first: true }); result.current.updateLpPatch({ second: true }); result.current.handlePlanCoverageChange('trust_included') })
    let done = false
    let barrier!: Promise<boolean>
    await act(async () => { barrier = result.current.flushAndSave().then(v => { done = true; return v }) })
    expect(done).toBe(false)
    await act(async () => { finish(); expect(await barrier).toBe(true) })
    expect(saveLiDesignSheet).toHaveBeenLastCalledWith('m', { first: true, second: true })
    expect(updatePlanCoverage).toHaveBeenCalledWith('m', 'trust_included')
  })
  it('keeps an LP save failure visible even after a regular sheet save and retries it at the barrier', async () => {
    vi.mocked(saveLiDesignSheet).mockRejectedValue(new Error('Offline'))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()))
    const { result } = renderHook(() => useDesignSheetState({ ...args, lpData: { li_design_sheet_data: {}, li_plan_coverage: 'no_trust', li_design_sheet_approved: false } }))
    await act(async () => { result.current.updateLpPatch({ retained: true }) })
    act(() => result.current.updateField('client_name', 'New name'))
    await act(async () => { await result.current.persistSheet(); expect(await result.current.flushAndSave()).toBe(false) })
    expect(result.current.saveStatus).toBe('error')
    expect(result.current.lpDataState?.li_design_sheet_data.retained).toBe(true)
    vi.mocked(saveLiDesignSheet).mockResolvedValue(undefined)
    await act(async () => { expect(await result.current.flushAndSave()).toBe(true) })
    expect(result.current.saveStatus).toBe('saved')
  })
  it('never retries an older failed LP snapshot behind a newer queued edit', async () => {
    vi.mocked(saveLiDesignSheet).mockRejectedValueOnce(new Error('Offline')).mockResolvedValue(undefined)
    const { result } = renderHook(() => useDesignSheetState({ ...args, lpData: { li_design_sheet_data: {}, li_plan_coverage: 'no_trust', li_design_sheet_approved: false } }))
    await act(async () => { result.current.updateLpPatch({ agent: 'Before' }) })
    await act(async () => { result.current.updateLpPatch({ agent: 'After' }); expect(await result.current.flushAndSave()).toBe(true) })
    expect(saveLiDesignSheet).toHaveBeenCalledTimes(2)
    expect(saveLiDesignSheet).toHaveBeenLastCalledWith('m', { agent: 'After' })
  })
})
