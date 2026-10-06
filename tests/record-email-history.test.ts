import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The record's email history: outbound from `email_log`, inbound from
 * `email_inbound_messages`, the inbound marked read on the way out, and a
 * missing inbound table leaving the outbound history exactly as it was.
 */

type Result = { data: unknown; error: { code?: string; message: string } | null }

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  results: {} as Record<string, Result>,
  calls: [] as Array<{ table: string; op: string; args: unknown[] }>,
}))

vi.mock('@/lib/apiAuth', () => ({ requireAdmin: mocks.auth }))
vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      const record = (op: string) => (...args: unknown[]) => {
        mocks.calls.push({ table, op, args })
        return chain
      }
      for (const op of ['select', 'eq', 'order', 'limit', 'in', 'is', 'update']) chain[op] = record(op)
      chain.then = (resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) => {
        const key = mocks.calls.some(call => call.table === table && call.op === 'update') ? `${table}:update` : table
        return Promise.resolve(mocks.results[key] ?? { data: [], error: null }).then(resolve, reject)
      }
      return chain
    },
  }),
}))
vi.mock('@/lib/email/gmailRead', () => ({ htmlToText: (value: string) => value.replace(/<[^>]*>/g, '') }))

import { GET } from '@/app/api/admin/comms/email-history/route'

const id = '123e4567-e89b-42d3-a456-426614174000'
const sent = { id: 'email-1', subject: 'Review', html: '<p>Review documents</p>', status: 'suppressed', to_email: 'client@example.test', sent_at: '2026-09-11T12:00:00Z' }
const received = {
  id: 'in-1', gmail_thread_id: 'thread-9', sender_email: 'client@example.test', sender_name: 'Pat Smith',
  subject: 'Deed question', snippet: 'Quick question about the deed', received_at: '2026-09-12T12:00:00Z', read_by_staff_at: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.calls.length = 0
  for (const key of Object.keys(mocks.results)) delete mocks.results[key]
  mocks.auth.mockResolvedValue({ err: null })
  mocks.results.email_log = { data: [sent], error: null }
  mocks.results.email_inbound_messages = { data: [], error: null }
  mocks.results.email_triage_threads = { data: [], error: null }
})

describe('Record email history', () => {
  it('returns record scoped outbound logs and preserves suppressed status', async () => {
    const response = await GET(new Request(`http://local/api/admin/comms/email-history?type=lead&id=${id}`))
    expect(mocks.calls).toContainEqual({ table: 'email_log', op: 'eq', args: ['lead_id', id] })
    expect(await response.json()).toEqual([{ id: 'email-1', channel: 'email', direction: 'outbound', body: 'Review documents', meta: 'Review · suppressed', sender: 'To client@example.test', created_at: '2026-09-11T12:00:00Z' }])
  })

  it('uses the recorded creation time when historical email has no sent timestamp', async () => {
    mocks.results.email_log = { data: [{ ...sent, id: 'old-email', html: '', status: 'sent', sent_at: null, created_at: '2026-08-01T12:00:00Z' }], error: null }
    const response = await GET(new Request(`http://local/api/admin/comms/email-history?type=lead&id=${id}`))
    expect((await response.json())[0].created_at).toBe('2026-08-01T12:00:00Z')
  })

  it('adds the inbound mail filed on the record, with the open triage row as the reply path, and marks it read', async () => {
    mocks.results.email_inbound_messages = { data: [received], error: null }
    mocks.results.email_triage_threads = { data: [{ id: 'triage-3', gmail_thread_id: 'thread-9', status: 'drafted' }], error: null }
    const response = await GET(new Request(`http://local/api/admin/comms/email-history?type=matter&id=${id}`))
    const items = await response.json()
    expect(mocks.calls).toContainEqual({ table: 'email_inbound_messages', op: 'eq', args: ['matter_id', id] })
    expect(items).toHaveLength(2)
    expect(items[1]).toMatchObject({
      id: 'in-1', channel: 'email', direction: 'inbound', body: 'Quick question about the deed', meta: 'Deed question',
      sender: 'Pat Smith <client@example.test>', body_href: '/api/admin/comms/email-inbound/in-1',
    })
    expect(items[1].links.map((link: { label: string }) => link.label)).toEqual(['Reply in Email triage', 'Open in Gmail'])
    expect(mocks.calls.filter(call => call.table === 'email_inbound_messages' && call.op === 'update')).toHaveLength(1)
    expect(mocks.calls).toContainEqual({ table: 'email_inbound_messages', op: 'in', args: ['id', ['in-1']] })
  })

  it('leaves mail already read alone', async () => {
    mocks.results.email_inbound_messages = { data: [{ ...received, read_by_staff_at: '2026-09-12T13:00:00Z' }], error: null }
    await GET(new Request(`http://local/api/admin/comms/email-history?type=contact&id=${id}`))
    expect(mocks.calls.filter(call => call.table === 'email_inbound_messages' && call.op === 'update')).toHaveLength(0)
    expect(mocks.calls).toContainEqual({ table: 'email_inbound_messages', op: 'eq', args: ['contact_id', id] })
  })

  it('serves the outbound history unchanged while the inbound table has not been deployed', async () => {
    mocks.results.email_inbound_messages = { data: null, error: { code: '42P01', message: 'relation "public.email_inbound_messages" does not exist' } }
    const response = await GET(new Request(`http://local/api/admin/comms/email-history?type=lead&id=${id}`))
    expect(response.status).toBe(200)
    expect(await response.json()).toHaveLength(1)
  })

  it('requires admin authentication before querying logs', async () => {
    mocks.auth.mockResolvedValue({ err: new Response('Unauthorized', { status: 401 }) })
    expect((await GET(new Request(`http://local/api/admin/comms/email-history?type=lead&id=${id}`))).status).toBe(401)
    expect(mocks.calls).toHaveLength(0)
  })

  it('returns an error rather than an empty history when storage fails', async () => {
    mocks.results.email_log = { data: null, error: { message: 'Database unavailable' } }
    expect((await GET(new Request(`http://local/api/admin/comms/email-history?type=lead&id=${id}`))).status).toBe(500)
  })
})
