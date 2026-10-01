import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createActionProposal: vi.fn(),
  executeActionProposal: vi.fn(),
}))
vi.mock('@/lib/apiAuth', () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock('@/lib/actions/server', () => ({
  createActionProposal: mocks.createActionProposal,
  executeActionProposal: mocks.executeActionProposal,
}))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: vi.fn() }))

import { POST } from '@/app/api/admin/assistant/proposals/route'

function post(body: unknown) {
  return POST(new Request('http://localhost/api/admin/assistant/proposals', {
    method: 'POST',
    body: JSON.stringify(body),
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAdmin.mockResolvedValue({
    err: null,
    userId: 'user-1',
    user: { id: 'user-1', email: 'attorney@example.com' },
  })
  mocks.createActionProposal.mockResolvedValue({ proposal: { id: 'proposal-1' } })
  mocks.executeActionProposal.mockResolvedValue({ execution: { id: 'execution-1' }, duplicate: false, result: {} })
})

describe('accepting an assistant proposal', () => {
  it('refuses an unauthenticated caller', async () => {
    mocks.requireAdmin.mockResolvedValue({ err: Response.json({ error: 'Unauthorized' }, { status: 401 }) })
    expect((await post({ kind: 'create_lead', payload: {}, proposalId: 'tool-1' })).status).toBe(401)
    expect(mocks.createActionProposal).not.toHaveBeenCalled()
  })

  it('routes lead creation through the shared idempotent action registry', async () => {
    mocks.executeActionProposal.mockResolvedValue({
      execution: { id: 'execution-1' },
      duplicate: false,
      result: { leadId: 'lead-1', clientName: 'Jane Doe' },
    })
    const response = await post({
      kind: 'create_lead',
      proposalId: 'tool-1',
      payload: { client_name: 'Jane Doe', client_email: 'jane@example.com', practice_area: 'EP' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, url: '/admin/crm/opportunities/lead-1' })
    expect(mocks.createActionProposal).toHaveBeenCalledWith(expect.objectContaining({
      actionKey: 'lead.create',
      source: 'assistant',
      idempotencyKey: 'assistant:user-1:tool-1',
    }), expect.objectContaining({ id: 'user-1' }))
    expect(mocks.executeActionProposal).toHaveBeenCalledWith('proposal-1', expect.objectContaining({ id: 'user-1' }))
  })

  it('requires a stable proposal id before any write is prepared', async () => {
    const response = await post({ kind: 'create_lead', payload: { client_name: 'Jane Doe' } })
    expect(response.status).toBe(400)
    expect(mocks.createActionProposal).not.toHaveBeenCalled()
  })

  it('routes task creation through the registry with the accepting attorney', async () => {
    mocks.executeActionProposal.mockResolvedValue({
      execution: { id: 'execution-1' }, duplicate: false, result: { id: 'task-1', title: 'Call the client' },
    })
    const response = await post({
      kind: 'create_task',
      proposalId: 'tool-2',
      payload: { title: 'Call the client', matter_id: '00000000-0000-0000-0000-000000000002' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, taskId: 'task-1' })
    expect(mocks.createActionProposal).toHaveBeenCalledWith(
      expect.objectContaining({ actionKey: 'task.create' }),
      expect.objectContaining({ id: 'user-1' }),
    )
  })

  it('rejects a kind it does not know', async () => {
    expect((await post({ kind: 'drop_database', payload: {}, proposalId: 'tool-3' })).status).toBe(400)
  })
})
