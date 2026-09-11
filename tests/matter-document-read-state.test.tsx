// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMatterDocuments } from '@/app/admin/matters/[id]/useMatterDocuments'
import type { MatterDocument } from '@/types/database'

const { listDocuments, listDocumentFolders } = vi.hoisted(() => ({
  listDocuments: vi.fn(), listDocumentFolders: vi.fn(),
}))
vi.mock('@/lib/documents', () => ({ listDocuments, listDocumentFolders }))
const doc = { id: 'doc-a', matter_id: 'a', name: 'Existing document' } as unknown as MatterDocument

beforeEach(() => {
  listDocuments.mockReset().mockResolvedValue([doc])
  listDocumentFolders.mockReset().mockResolvedValue([])
})
afterEach(cleanup)

describe('matter document read state', () => {
  it('defers reads until activated and reuses the same matter on tab return', async () => {
    const { result, rerender } = renderHook(({ id, enabled }) => useMatterDocuments(id, enabled), { initialProps: { id: 'a', enabled: false } })
    expect(listDocuments).not.toHaveBeenCalled()
    expect(listDocumentFolders).not.toHaveBeenCalled()
    rerender({ id: 'a', enabled: true })
    await waitFor(() => expect(result.current.documents).toEqual([doc]))
    rerender({ id: 'a', enabled: false })
    rerender({ id: 'a', enabled: true })
    expect(listDocuments).toHaveBeenCalledTimes(1)
    rerender({ id: 'b', enabled: false })
    expect(result.current.documents).toEqual([])
    expect(listDocuments).toHaveBeenCalledTimes(1)
    listDocuments.mockResolvedValue([])
    rerender({ id: 'b', enabled: true })
    await waitFor(() => expect(listDocuments).toHaveBeenCalledTimes(2))
  })

  it('preserves successful documents after a refresh fails', async () => {
    const { result } = renderHook(() => useMatterDocuments('a'))
    await waitFor(() => expect(result.current.documents).toEqual([doc]))
    listDocuments.mockRejectedValueOnce(new Error('offline'))
    await act(() => result.current.reload())
    expect(result.current.documents).toEqual([doc])
    expect(result.current.documentsError).toBeTruthy()
    expect(result.current.loading).toBe(false)
    await act(() => result.current.reload())
    expect(result.current.documentsError).toBeNull()
  })

  it('keeps successful documents when only folders fail', async () => {
    listDocumentFolders.mockRejectedValueOnce(new Error('offline'))
    const { result } = renderHook(() => useMatterDocuments('a'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.documents).toEqual([doc])
    expect(result.current.documentsError).toBeNull()
    expect(result.current.foldersError).toBeTruthy()
  })

  it('does not let a late response for another matter replace current data', async () => {
    let finishA!: (docs: MatterDocument[]) => void
    listDocuments.mockImplementationOnce(() => new Promise(resolve => { finishA = resolve }))
    const { result, rerender } = renderHook(({ id }) => useMatterDocuments(id), { initialProps: { id: 'a' } })
    listDocuments.mockResolvedValue([])
    rerender({ id: 'b' })
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => { finishA([doc]) })
    expect(result.current.documents).toEqual([])
  })

  it('shows a failure instead of an empty success on the initial read', async () => {
    listDocuments.mockRejectedValueOnce(new Error('offline'))
    const { result } = renderHook(() => useMatterDocuments('a'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.documentsError).toBeTruthy()
  })
})
