import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * What the documents tab is allowed to learn about a signature request.
 *
 * The send is a POST that answers once. This is the only way an attorney finds
 * out what happened afterwards, so it has to be scoped to the matter in the URL
 * and it must not hand a signing credential to a browser.
 */

const state = vi.hoisted(() => ({
  admin: true,
  flag: true,
  tables: {} as Record<string, Record<string, unknown>[]>,
}))

vi.mock('@/lib/apiAuth', () => ({
  requireAdmin: vi.fn(async () => (state.admin
    ? { err: null, userId: 'user-1', user: { id: 'user-1' } }
    : { err: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }), userId: null, user: null })),
}))
vi.mock('@/lib/esign/documentSignature', () => ({
  esignDocumentsEnabled: vi.fn(async () => state.flag),
  createDocumentSignatureRequest: vi.fn(),
  DocumentSignatureError: class extends Error {},
}))
vi.mock('@/lib/r2', () => ({ getR2Client: () => ({}), r2Bucket: () => 'bucket' }))
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: vi.fn() }))

/**
 * A fake that filters but deliberately does *not* project: every row is handed
 * over whole, token hash and all. A narrow select is not what keeps a
 * credential out of the response — the response being built field by field is.
 * Handing the route everything is what makes that assertion mean something.
 */
function table(rows: Record<string, unknown>[]) {
  let working = [...rows]
  const builder: Record<string, unknown> = {
    select() {
      return builder
    },
    eq(column: string, value: unknown) {
      working = working.filter(row => row[column] === value)
      return builder
    },
    in(column: string, values: unknown[]) {
      working = working.filter(row => values.includes(row[column]))
      return builder
    },
    order(column: string, options?: { ascending?: boolean }) {
      const direction = options?.ascending === false ? -1 : 1
      working = [...working].sort((a, b) =>
        direction * String(a[column] ?? '').localeCompare(String(b[column] ?? '')))
      return builder
    },
    then(resolve: (value: { data: unknown; error: null }) => void) {
      resolve({ data: working, error: null })
    },
  }
  return builder
}

vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({ from: (name: string) => table(state.tables[name] ?? []) }),
}))

import { GET } from '@/app/api/admin/matters/[id]/signature-requests/route'

const MATTER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER_MATTER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

async function get(matterId = MATTER) {
  const response = await GET(
    new Request(`http://localhost/api/admin/matters/${matterId}/signature-requests`),
    { params: Promise.resolve({ id: matterId }) },
  )
  return { status: response.status, body: await response.json() }
}

// The fixtures describe a request sent 2026-09-18 whose signing links expire
// 2026-09-25. Pin the clock inside that week so the test doesn't expire with them.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-19T12:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
})

beforeEach(() => {
  state.admin = true
  state.flag = true
  state.tables = {
    signature_requests: [
      {
        id: 'req-1', matter_id: MATTER, name: 'HIPAA Authorization',
        source_document_id: 'doc-1', status: 'sent', sent_at: '2026-09-18T10:00:00Z',
        completed_at: null, provider_sync_error: null, created_at: '2026-09-18T10:00:00Z',
      },
      {
        id: 'req-2', matter_id: OTHER_MATTER, name: "Another matter's form",
        source_document_id: 'doc-9', status: 'sent', sent_at: '2026-09-18T11:00:00Z',
        completed_at: null, provider_sync_error: null, created_at: '2026-09-18T11:00:00Z',
      },
    ],
    signature_request_recipients: [
      { request_id: 'req-1', recipient_key: 'signer_1', recipient_order: 1, name: 'Walter White', email: 'walter@example.com', status: 'pending' },
      { request_id: 'req-1', recipient_key: 'signer_2', recipient_order: 2, name: 'Skylar White', email: 'skylar@example.com', status: 'pending' },
      { request_id: 'req-2', recipient_key: 'signer_1', recipient_order: 1, name: 'Someone Else', email: 'else@example.com', status: 'pending' },
    ],
    esign_signing_sessions: [
      {
        signature_request_id: 'req-1', recipient_key: 'signer_1', status: 'signed',
        expires_at: '2026-09-25T10:00:00Z', viewed_at: '2026-09-18T12:00:00Z',
        signed_at: '2026-09-18T12:05:00Z', declined_at: null,
        token_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      },
      {
        signature_request_id: 'req-1', recipient_key: 'signer_2', status: 'sent',
        expires_at: '2026-09-25T10:00:00Z', viewed_at: null, signed_at: null, declined_at: null,
        token_hash: 'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592',
      },
    ],
  }
})

describe('GET signature requests', () => {
  it('returns only this matter’s requests', async () => {
    const { body } = await get()
    expect(body.requests.map((request: { id: string }) => request.id)).toEqual(['req-1'])
  })

  it('derives progress from the signing sessions, not the recipient rows', async () => {
    // signature_request_recipients.status is written once at insert and never
    // updated — every row in it says `pending` forever. Reading it would tell
    // an attorney nobody had signed.
    const { body } = await get()
    const request = body.requests[0]
    expect(request.state).toBe('partially_signed')
    expect(request.signedCount).toBe(1)
    expect(request.signerCount).toBe(2)
    expect(request.signers.map((signer: { email: string; state: string }) => [signer.email, signer.state]))
      .toEqual([['walter@example.com', 'signed'], ['skylar@example.com', 'sent']])
    expect(request.signers[0].signedAt).toBe('2026-09-18T12:05:00Z')
  })

  it('never hands a signing credential to the browser', async () => {
    // The link is the only thing standing between a stranger and a signature.
    // Its hash is not the link, but nothing in a status panel needs either.
    const { body } = await get()
    expect(JSON.stringify(body)).not.toContain('token_hash')
    expect(JSON.stringify(body)).not.toContain('e3b0c44298fc1c1')
  })

  it('reports a failed send with the reason recorded on the row', async () => {
    // A send that threw after the row existed returns 400 with no requestId, so
    // this listing is the only place the failure is visible at all.
    state.tables.signature_requests = [{
      id: 'req-3', matter_id: MATTER, name: 'Fee schedule', source_document_id: 'doc-2',
      status: 'failed', sent_at: null, completed_at: null,
      provider_sync_error: 'Anchor [[SIGN_2_DATE]] was not found', created_at: '2026-09-18T09:00:00Z',
    }]
    state.tables.signature_request_recipients = [
      { request_id: 'req-3', recipient_key: 'signer_1', recipient_order: 1, name: 'Walter White', email: 'walter@example.com', status: 'pending' },
    ]
    state.tables.esign_signing_sessions = []

    const { body } = await get()
    expect(body.requests[0].state).toBe('failed')
    expect(body.requests[0].error).toContain('was not found')
    // Nobody was emailed, but the roll is still who it was meant for.
    expect(body.requests[0].signerCount).toBe(1)
    expect(body.requests[0].signers[0].state).toBe('pending')
  })

  it('returns nothing at all when the firm does not have the feature', async () => {
    state.flag = false
    expect((await get()).body).toEqual({ requests: [] })
  })

  it('returns nothing for an id that is not a matter', async () => {
    // The lead/matter routes share this path and an alias can reach it; a
    // non-uuid would otherwise make Postgres throw rather than answer.
    expect((await get('not-a-uuid')).body).toEqual({ requests: [] })
  })

  it('refuses anyone who is not staff', async () => {
    state.admin = false
    expect((await get()).status).toBe(403)
  })
})
