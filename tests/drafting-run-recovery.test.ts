import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ from: vi.fn(), updates: [] as Array<{ table: string; patch: Record<string, unknown> }>, cas: true }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ from: mocks.from }) }))
import { latestDraftRun, publicDraftRun } from '@/lib/drafting/runStore'
const run = { id: 'run', matter_id: 'matter', source_revision: 'rev', request_hash: 'private', worker_token: 'private', requested_documents: ['trust.docx'], status: 'running' as const, outcomes: [], lease_expires_at: '2000-01-01T00:00:00Z', created_at: '2000-01-01T00:00:00Z', updated_at: '', error: null }
beforeEach(() => {
  mocks.cas = true; mocks.updates = []
  mocks.from.mockImplementation((table: string) => {
    let mutation = false, selection = ''
    const chain: Record<string, unknown> = {}
    for (const key of ['eq', 'is', 'order', 'limit', 'lte', 'in']) chain[key] = () => chain
    chain.select = (columns: string) => { selection = columns; return chain }
    chain.update = (patch: Record<string, unknown>) => { mutation = true; mocks.updates.push({ table, patch }); return chain }
    const result = () => ({ data: table === 'draft_generation_runs' ? mutation ? mocks.cas ? { id: 'run' } : null : run : selection.includes('draft_run_output') ? [{ id: 'doc', name: 'Renamed.docx', draft_run_output: 'trust.docx', marker_count: 0 }] : [], error: null })
    chain.maybeSingle = async () => result()
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve)
    return chain
  })
})
it('recovers an expired run killed after document commit into a completed status', async () => {
  const recovered = await latestDraftRun('matter')
  expect(recovered?.status).toBe('completed')
  expect(recovered?.outcomes).toEqual([{ filename: 'trust.docx', name: 'Renamed.docx', status: 'saved', documentId: 'doc', markerCount: 0 }])
  expect(mocks.updates[0].patch.status).toBe('completed')
  expect(publicDraftRun(recovered!)).not.toHaveProperty('worker_token')
  expect(publicDraftRun(recovered!)).not.toHaveProperty('request_hash')
})
it('does not present recovery as complete if a concurrent retry already replaced the owner', async () => {
  mocks.cas = false
  expect((await latestDraftRun('matter'))?.status).toBe('running')
  expect(mocks.updates.some(update => update.table === 'matter_documents')).toBe(false)
})
