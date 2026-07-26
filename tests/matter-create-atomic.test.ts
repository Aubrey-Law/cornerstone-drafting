import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Executed-handler tests for POST /api/admin/matters/create.
 *
 * The route used to perform five sequential un-transacted writes with no
 * idempotency key, so a double-click or a retry after a lost response created
 * duplicate clients and duplicate matters, and a failure partway left a matter
 * with no matter_details row.
 */

const rpc = vi.fn()
const maybeSingle = vi.fn()

vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({
    rpc,
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  }),
  ADMIN_EMAIL: 'admin@example.invalid',
}))

vi.mock('@/lib/apiAuth', () => ({
  requireAdmin: async () => ({ err: null, userId: 'attorney-1' }),
}))

const generateUniqueMatterNumber = vi.fn()
vi.mock('@/lib/matterNumber', () => ({
  generateUniqueMatterNumber: (...a: unknown[]) => generateUniqueMatterNumber(...a),
}))

vi.mock('@/lib/designSheet/ensureDesignSheetSeeded', () => ({
  ensureDesignSheetSeededFromIntake: vi.fn(async () => true),
}))

function request(body: Record<string, unknown>) {
  return new Request('https://app.test/api/admin/matters/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const VALID = {
  clientName: 'Ada Lovelace',
  clientEmail: 'ada@example.invalid',
  planType: 'EP',
  requestId: '33333333-3333-3333-3333-333333333333',
}

beforeEach(() => {
  rpc.mockReset()
  maybeSingle.mockReset().mockResolvedValue({ data: null, error: null })
  generateUniqueMatterNumber.mockReset().mockResolvedValue('2026-EP-Lovelace-001')
})

afterEach(() => vi.clearAllMocks())

describe('atomic matter create', () => {
  it('creates the matter through a single transactional RPC', async () => {
    rpc.mockResolvedValue({
      data: [{ matter_id: 'm-1', matter_number: '2026-EP-Lovelace-001', client_intake_id: 'i-1', created: true }],
      error: null,
    })
    const { POST } = await import('@/app/api/admin/matters/create/route')

    const res = await POST(request(VALID))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.matterId).toBe('m-1')
    // One call: intake + matter + linkage + details + activity happen together.
    const createCalls = rpc.mock.calls.filter(([fn]) => fn === 'create_matter_with_client')
    expect(createCalls).toHaveLength(1)
    expect(createCalls[0][1].p_request_id).toBe(VALID.requestId)
  })

  it('forwards the idempotency key so a repeat submission returns the same matter', async () => {
    // Second submission with the same key: the RPC reports created=false and
    // returns the original matter rather than making a second one.
    rpc.mockResolvedValue({
      data: [{ matter_id: 'm-1', matter_number: '2026-EP-Lovelace-001', client_intake_id: 'i-1', created: false }],
      error: null,
    })
    const { POST } = await import('@/app/api/admin/matters/create/route')

    const res = await POST(request(VALID))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.matterId).toBe('m-1')
    expect(json.created).toBe(false)
  })

  it('rejects a malformed idempotency key instead of passing it through', async () => {
    rpc.mockResolvedValue({
      data: [{ matter_id: 'm-2', matter_number: 'n', client_intake_id: 'i-2', created: true }],
      error: null,
    })
    const { POST } = await import('@/app/api/admin/matters/create/route')

    await POST(request({ ...VALID, requestId: 'not-a-uuid' }))

    expect(rpc.mock.calls[0][1].p_request_id).toBeNull()
  })

  it('reallocates the matter number and retries on a unique collision', async () => {
    generateUniqueMatterNumber
      .mockResolvedValueOnce('2026-EP-Lovelace-001')
      .mockResolvedValueOnce('2026-EP-Lovelace-002')
    rpc
      .mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'duplicate matter_number' } })
      .mockResolvedValueOnce({
        data: [{ matter_id: 'm-3', matter_number: '2026-EP-Lovelace-002', client_intake_id: 'i-3', created: true }],
        error: null,
      })
    const { POST } = await import('@/app/api/admin/matters/create/route')

    const res = await POST(request(VALID))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.matterNumber).toBe('2026-EP-Lovelace-002')
    expect(generateUniqueMatterNumber).toHaveBeenCalledTimes(2)
  })

  it('does not retry on a non-collision error', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'Service role required' } })
    const { POST } = await import('@/app/api/admin/matters/create/route')

    const res = await POST(request(VALID))

    expect(res.status).toBe(500)
    expect(rpc.mock.calls.filter(([fn]) => fn === 'create_matter_with_client')).toHaveLength(1)
  })

  it('requires a client name and email', async () => {
    const { POST } = await import('@/app/api/admin/matters/create/route')

    const res = await POST(request({ clientName: '', clientEmail: '' }))

    expect(res.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })
})
