import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeClient } from './helpers/reviewFakeSupabase'

vi.mock('server-only', () => ({}))
const state = vi.hoisted(() => ({ client: null as unknown, denied: false }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: vi.fn(() => state.client) }))
vi.mock('@/lib/apiAuth', () => ({
  requireAdmin: vi.fn(async () =>
    state.denied
      ? { err: new Response('Unauthorized', { status: 401 }), userId: null }
      : { err: null, userId: 'user-1', user: { id: 'user-1' } },
  ),
}))

import { POST } from '@/app/api/addin/scan/decision/route'

const SCAN = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

function post(body: unknown) {
  return POST(new Request('http://localhost/api/addin/scan/decision', { method: 'POST', body: JSON.stringify(body) }))
}

let client: ReturnType<typeof makeFakeClient>
beforeEach(() => {
  state.denied = false
  client = makeFakeClient({
    document_scan_items: [{ id: 'row-1', scan_id: SCAN, item_key: 'issues-0-0', disposition: 'open', disposition_note: null, disposition_by: null, disposition_at: null }],
  })
  state.client = client
})

describe('POST /api/addin/scan/decision', () => {
  it('records a decision made in Word on the item the pane streamed', async () => {
    const res = await post({ scanId: SCAN, itemKey: 'issues-0-0', disposition: 'rejected', note: 'Dismissed in Word' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, itemId: 'row-1' })
    expect(client.tableRows('document_scan_items')[0]).toMatchObject({
      disposition: 'rejected',
      disposition_note: 'Dismissed in Word',
      disposition_by: 'user-1',
    })
  })

  it('answers 404 for an item that is not saved', async () => {
    const res = await post({ scanId: SCAN, itemKey: 'issues-3-1', disposition: 'accepted' })
    expect(res.status).toBe(404)
  })

  it('rejects a malformed request before touching anything', async () => {
    for (const body of [
      { scanId: 'x', itemKey: 'issues-0-0', disposition: 'accepted' },
      { scanId: SCAN, itemKey: '', disposition: 'accepted' },
      { scanId: SCAN, itemKey: 'issues-0-0', disposition: 'approved' },
    ]) {
      expect((await post(body)).status).toBe(400)
    }
    expect(client.tableRows('document_scan_items')[0]).toMatchObject({ disposition: 'open' })
  })

  it('gates itself', async () => {
    state.denied = true
    expect((await post({ scanId: SCAN, itemKey: 'issues-0-0', disposition: 'accepted' })).status).toBe(401)
    expect(client.tableRows('document_scan_items')[0]).toMatchObject({ disposition: 'open' })
  })
})
