import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Who may withdraw or re-send a signature request, and on whose behalf.
 *
 * The request id arrives in the URL. The only thing standing between that and
 * an admin cancelling another matter's request is the scope check, so most of
 * these are about establishing that it runs before anything else does.
 */

const state = vi.hoisted(() => ({
  admin: true,
  flag: true,
  request: null as Record<string, unknown> | null,
  cancelled: [] as unknown[],
  resent: [] as unknown[],
}))

vi.mock('@/lib/apiAuth', () => ({
  requireAdmin: vi.fn(async () => (state.admin
    ? { err: null, userId: 'user-1', user: { id: 'user-1' } }
    : { err: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }), userId: null, user: null })),
}))
vi.mock('@/lib/esign/documentLifecycle', () => ({
  esignDocumentsEnabled: vi.fn(async () => state.flag),
  cancelDocumentSignatureRequest: vi.fn(async (input: unknown) => { state.cancelled.push(input); return { ok: true } }),
  resendDocumentSignatureLink: vi.fn(async (input: unknown) => { state.resent.push(input); return { ok: true, email: 'walter@example.com' } }),
  DocumentSignatureError: class extends Error {},
}))
vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({
    from: () => {
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = () => chain
      chain.maybeSingle = async () => ({ data: state.request, error: null })
      return chain
    },
  }),
}))

import { POST as cancel } from '@/app/api/admin/matters/[id]/signature-requests/[requestId]/cancel/route'
import { POST as resend } from '@/app/api/admin/matters/[id]/signature-requests/[requestId]/resend/route'

const MATTER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const REQUEST = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

async function call(
  handler: typeof cancel,
  body: unknown,
  { matterId = MATTER, requestId = REQUEST } = {},
) {
  const response = await handler(
    new Request('http://localhost/x', { method: 'POST', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: matterId, requestId }) },
  )
  return { status: response.status, body: await response.json() }
}

beforeEach(() => {
  state.admin = true
  state.flag = true
  state.cancelled = []
  state.resent = []
  state.request = { id: REQUEST, matter_id: MATTER }
})

describe('cancelling', () => {
  it('withdraws the request on behalf of the signed-in attorney', async () => {
    const { status, body } = await call(cancel, { reason: 'Wrong version sent' })
    expect(status).toBe(200)
    expect(body).toEqual({ ok: true })
    expect(state.cancelled).toEqual([{
      requestId: REQUEST, reason: 'Wrong version sent', cancelledBy: 'user-1',
    }])
  })

  it('refuses a request that belongs to another matter', async () => {
    // The id is in the URL, so it is checked rather than trusted.
    state.request = { id: REQUEST, matter_id: OTHER }
    const { status } = await call(cancel, { reason: 'Wrong version sent' })
    expect(status).toBe(404)
    expect(state.cancelled).toHaveLength(0)
  })

  it('refuses without a reason', async () => {
    const { status, body } = await call(cancel, { reason: '  ' })
    expect(status).toBe(400)
    expect(body.error).toMatch(/say why/i)
    expect(state.cancelled).toHaveLength(0)
  })

  it('refuses when the firm does not have the feature', async () => {
    state.flag = false
    expect((await call(cancel, { reason: 'Wrong version sent' })).status).toBe(403)
    expect(state.cancelled).toHaveLength(0)
  })

  it('refuses anyone who is not staff', async () => {
    state.admin = false
    expect((await call(cancel, { reason: 'Wrong version sent' })).status).toBe(403)
    expect(state.cancelled).toHaveLength(0)
  })
})

describe('resending', () => {
  it('sends one named signer a new link', async () => {
    const { status, body } = await call(resend, { recipientKey: 'signer_2', expirationHours: 336 })
    expect(status).toBe(200)
    expect(body).toEqual({ ok: true, email: 'walter@example.com' })
    expect(state.resent).toEqual([{ requestId: REQUEST, recipientKey: 'signer_2', expirationHours: 336 }])
  })

  it('will not resend to everybody by omission', async () => {
    // A missing recipient must not quietly mean "all of them": that is an
    // email to every signer and a fresh link superseding the ones they hold.
    const { status, body } = await call(resend, {})
    expect(status).toBe(400)
    expect(body.error).toMatch(/which signer/i)
    expect(state.resent).toHaveLength(0)
  })

  it('refuses a request that belongs to another matter', async () => {
    state.request = { id: REQUEST, matter_id: OTHER }
    expect((await call(resend, { recipientKey: 'signer_1' })).status).toBe(404)
    expect(state.resent).toHaveLength(0)
  })
})
