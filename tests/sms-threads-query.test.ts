import { beforeEach, describe, expect, it, vi } from 'vitest'

// Rows each table/view returns for this test; `in()` filters are ignored, the
// fixtures only hold the rows the query would ask for.
const tables = vi.hoisted(() => ({ rows: {} as Record<string, unknown[]> }))

vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      const result = { data: tables.rows[table] ?? [], error: null }
      const chain: Record<string, unknown> = {}
      for (const method of ['select', 'order', 'limit', 'gt', 'is', 'lt', 'in', 'eq']) {
        chain[method] = () => chain
      }
      chain.then = (resolve: (value: typeof result) => void) => resolve(result)
      return chain
    },
  }),
}))

import { listSmsThreads, threadMessagesFilter } from '@/lib/queries/smsThreads'

const base = {
  last_body: 'Hi', last_direction: 'inbound', last_status: 'received',
  last_message_at: '2026-09-20T00:00:00Z', unread_count: 1, recipient_name: null, opted_out: false,
}

beforeEach(() => {
  tables.rows = {
    v_sms_threads: [
      { ...base, phone: '5555550001', phone_e164: '+15555550001', lead_id: 'lead-1', matter_id: 'opp-1', contact_id: null },
      { ...base, phone: '5555550002', phone_e164: '+15555550002', lead_id: 'intake-2', matter_id: 'matter-2', contact_id: null },
      { ...base, phone: '5555550003', phone_e164: '+15555550003', lead_id: null, matter_id: 'matter-2', contact_id: 'contact-3' },
      { ...base, phone: '5555550004', phone_e164: '+15555550004', lead_id: null, matter_id: null, contact_id: null, recipient_name: 'Stale' },
    ],
    client_intake: [
      { id: 'lead-1', full_name: 'Lee Lead', first_name: null, last_name: null, matter_id: 'opp-1' },
      { id: 'intake-2', full_name: 'Casey Client', first_name: null, last_name: null, matter_id: 'matter-2' },
    ],
    contacts: [{ id: 'contact-3', first_name: 'Patricia', last_name: 'Trustee', preferred_name: 'Pat' }],
    v_matter_pipeline_all: [
      { matter_id: 'opp-1', client_name: 'Lee Lead', relationship_status: 'lead' },
      { matter_id: 'matter-2', client_name: 'Casey Client', relationship_status: 'hired' },
    ],
  }
})

describe('listSmsThreads', () => {
  it('labels each conversation lead, client, contact or unknown and links the right record', async () => {
    const threads = await listSmsThreads()
    expect(threads.map(t => [t.phone, t.kind, t.name, t.href])).toEqual([
      ['5555550001', 'lead', 'Lee Lead', '/admin/leads/lead-1'],
      ['5555550002', 'client', 'Casey Client', '/admin/matters/matter-2'],
      // The contact owns the thread even though it inherits the household matter.
      ['5555550003', 'contact', 'Pat Trustee', '/admin/contacts?selected=contact-3'],
      // No record: no name, even if an old row carried one.
      ['5555550004', 'unknown', null, null],
    ])
  })
})

describe('threadMessagesFilter', () => {
  it('matches the number as sender on inbound rows and recipient on outbound rows', () => {
    const filter = threadMessagesFilter('5555550123')
    expect(filter).toContain('and(direction.eq.inbound,from_number.in.("+15555550123","15555550123","5555550123"))')
    expect(filter).toContain('and(direction.eq.outbound,to_number.in.("+15555550123","15555550123","5555550123"))')
  })
})
