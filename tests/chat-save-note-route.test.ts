import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requireAdmin, rpc, from } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
}))
vi.mock('@/lib/apiAuth', () => ({ requireAdmin }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ rpc, from }) }))

import { POST } from '@/app/api/admin/chat/save-note/route'
import type { NextRequest } from 'next/server'

const NOTE = 'AI Assistant · the answer worth keeping.'

function req(body: unknown) {
  return new Request('http://localhost/api/admin/chat/save-note', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

/** The matter path inserts straight into matter_notes after checking the row exists. */
function matterTables(matter: { id: string } | null = { id: 'm1' }) {
  const insert = vi.fn(() => ({
    select: () => ({ single: async () => ({ data: { id: 'n1' }, error: null }) }),
  }))
  from.mockImplementation((table: string) => {
    if (table === 'matters') {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: matter, error: null }) }) }) }
    }
    return { insert }
  })
  return insert
}

beforeEach(() => {
  vi.clearAllMocks()
  requireAdmin.mockResolvedValue({ err: null, userId: 'u1' })
})

describe('saving an assistant answer from the chat rail', () => {
  it('files a lead note through the same transaction the lead notes tab uses', async () => {
    rpc.mockResolvedValue({ data: { id: 'n1', body: NOTE }, error: null })

    const res = await POST(req({ context_type: 'lead', context_id: 'l1', content: ` ${NOTE} ` }))

    expect(res.status).toBe(201)
    expect(rpc).toHaveBeenCalledWith('create_lead_note_with_activity', {
      p_lead_id: 'l1',
      p_body: NOTE,
      p_actor_id: 'u1',
      p_note_type: 'internal',
    })
    // The note is the attorney's, not the service role's.
    expect(from).not.toHaveBeenCalled()
  })

  it('files a lead note under the type the rail chose, internal by default', async () => {
    rpc.mockResolvedValue({ data: { id: 'n1' }, error: null })

    await POST(req({ context_type: 'lead', context_id: 'l1', content: NOTE, note_type: 'client_comm' }))
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_note_type: 'client_comm' })

    await POST(req({ context_type: 'lead', context_id: 'l1', content: NOTE }))
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_note_type: 'internal' })
  })

  it('maps the lead transaction failures to their own statuses', async () => {
    for (const [code, status] of [['42501', 403], ['P0002', 404], ['XX000', 500]] as const) {
      rpc.mockResolvedValueOnce({ data: null, error: { code, message: 'failed' } })
      const res = await POST(req({ context_type: 'lead', context_id: 'l1', content: NOTE }))
      expect(res.status).toBe(status)
    }
  })

  it('still writes a matter note, with its type', async () => {
    const insert = matterTables()

    const res = await POST(req({ context_type: 'matter', context_id: 'm1', content: NOTE, note_type: 'client_comm' }))

    expect(res.status).toBe(201)
    expect(insert).toHaveBeenCalledWith({ matter_id: 'm1', body: NOTE, note_type: 'client_comm' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('reports a matter that does not exist', async () => {
    matterTables(null)
    const res = await POST(req({ context_type: 'matter', context_id: 'gone', content: NOTE }))
    expect(res.status).toBe(404)
  })

  it('rejects an empty note, a missing id, and a context with no notes', async () => {
    expect((await POST(req({ context_type: 'lead', context_id: 'l1', content: '  ' }))).status).toBe(400)
    expect((await POST(req({ context_type: 'lead', content: NOTE }))).status).toBe(400)
    expect((await POST(req({ context_type: 'general', context_id: 'x', content: NOTE }))).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuses a caller who is not staff', async () => {
    requireAdmin.mockResolvedValueOnce({ err: Response.json({ error: 'Forbidden' }, { status: 403 }), userId: null })
    const res = await POST(req({ context_type: 'lead', context_id: 'l1', content: NOTE }))
    expect(res.status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  })
})
