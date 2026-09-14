import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createLead: vi.fn(),
  acceptTaskProposal: vi.fn(),
  createCalendarHold: vi.fn(),
}))
vi.mock('@/lib/apiAuth', () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock('@/lib/leads/createLead', () => ({ createLead: mocks.createLead }))
vi.mock('@/lib/adminChat/calendarTools', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/adminChat/calendarTools')>()),
  acceptTaskProposal: mocks.acceptTaskProposal,
}))
vi.mock('@/lib/appointments/googleEvents', () => ({ createCalendarHold: mocks.createCalendarHold }))
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
})

/**
 * The assistant's mutating tools now only propose. This route is where the
 * attorney's acceptance turns a proposal into a write — so it re-validates the
 * payload rather than trusting what the model put in the card.
 */
describe('accepting an assistant proposal', () => {
  it('refuses an unauthenticated caller', async () => {
    mocks.requireAdmin.mockResolvedValue({ err: Response.json({ error: 'Unauthorized' }, { status: 401 }) })
    expect((await post({ kind: 'create_lead', payload: {} })).status).toBe(401)
    expect(mocks.createLead).not.toHaveBeenCalled()
  })

  it('creates the lead only on acceptance', async () => {
    mocks.createLead.mockResolvedValue({
      leadId: 'lead-1', clientName: 'Jane Doe', clientEmail: 'jane@example.com', practiceArea: 'EP',
    })
    const response = await post({
      kind: 'create_lead',
      payload: { client_name: 'Jane Doe', client_email: 'jane@example.com', practice_area: 'EP' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, url: '/admin/crm/opportunities/lead-1' })
    expect(mocks.createLead).toHaveBeenCalledWith(expect.objectContaining({
      clientName: 'Jane Doe',
      clientEmail: 'jane@example.com',
    }))
  })

  it('re-validates the lead payload instead of trusting the card', async () => {
    const response = await post({ kind: 'create_lead', payload: { client_name: 'Jane Doe' } })

    expect(response.status).toBe(400)
    expect(mocks.createLead).not.toHaveBeenCalled()
  })

  it('creates the task, attributing it to the accepting attorney', async () => {
    mocks.acceptTaskProposal.mockResolvedValue({ id: 'task-1', title: 'Call the client' })
    const response = await post({
      kind: 'create_task',
      payload: { title: 'Call the client', matter_id: 'matter-1' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, taskId: 'task-1' })
    expect(mocks.acceptTaskProposal).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Call the client', matter_id: 'matter-1' }),
      expect.objectContaining({ id: 'user-1' }),
    )
  })

  it('rejects a kind it does not know', async () => {
    expect((await post({ kind: 'drop_database', payload: {} })).status).toBe(400)
  })
})
