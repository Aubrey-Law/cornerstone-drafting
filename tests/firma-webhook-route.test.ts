import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const state = {
    agreement: {
      id: 'agreement-1',
      matter_id: 'matter-1',
      status: 'sent',
    } as Record<string, unknown> | null,
    details: null as Record<string, unknown> | null,
    lead: null as Record<string, unknown> | null,
    claimStatus: 'claimed',
    updates: [] as Array<{ table: string; values: Record<string, unknown> }>,
  }
  const getEnvelopeState = vi.fn(async () => ({
    status: 'sent',
    recipients: [],
    finalDocumentUrl: null,
  }))
  const rpc = vi.fn(async () => ({ data: state.claimStatus, error: null }))

  function rowFor(table: string) {
    if (table === 'engagement_agreements') return state.agreement
    if (table === 'matter_details') return state.details
    if (table === 'client_intake') return state.lead
    if (table === 'matters') {
      return { id: 'matter-1', client_intake_id: 'lead-1', relationship_status: 'hired' }
    }
    return null
  }

  function builderFor(table: string) {
    const chain: Record<string, unknown> = {}
    chain.select = vi.fn(() => chain)
    chain.eq = vi.fn(() => chain)
    chain.neq = vi.fn(() => chain)
    chain.maybeSingle = vi.fn(async () => ({ data: rowFor(table), error: null }))
    chain.single = vi.fn(async () => ({ data: rowFor(table), error: null }))
    chain.update = vi.fn((values: Record<string, unknown>) => {
      state.updates.push({ table, values })
      return chain
    })
    return chain
  }

  const admin = {
    rpc,
    from: vi.fn((table: string) => builderFor(table)),
  }

  return { state, getEnvelopeState, rpc, admin }
})

vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => mocks.admin,
}))
vi.mock('@/lib/esign/verify', () => ({
  verifyFirmaWebhookSignature: () => true,
}))
vi.mock('@/lib/esign/firma', () => ({
  resolveEsignProvider: () => ({
    ok: true,
    provider: { getEnvelopeState: mocks.getEnvelopeState },
  }),
}))
vi.mock('@/lib/documentUpload', () => ({
  putFileToR2: vi.fn(),
  safeUploadFilename: (name: string) => name,
}))
vi.mock('@/lib/matters/createFromIntake', () => ({
  createMatterFromIntake: vi.fn(async () => ({
    ok: true,
    matterId: 'matter-1',
    matterNumber: '1',
  })),
}))

import { POST } from '@/app/api/webhooks/esign/route'

function request(payload: Record<string, unknown>) {
  return new Request('http://localhost/api/webhooks/esign', {
    method: 'POST',
    headers: { 'x-firma-signature': 'test-signature' },
    body: JSON.stringify(payload),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.FIRMA_WEBHOOK_SECRET = 'test-secret'
  mocks.state.agreement = {
    id: 'agreement-1',
    matter_id: 'matter-1',
    status: 'sent',
  }
  mocks.state.details = null
  mocks.state.lead = null
  mocks.state.claimStatus = 'claimed'
  mocks.state.updates = []
  mocks.getEnvelopeState.mockResolvedValue({
    status: 'sent',
    recipients: [],
    finalDocumentUrl: null,
  })
})

describe('Firma webhook route behavior', () => {
  it('acknowledges Firma webhook test deliveries without requiring a signing request', async () => {
    const response = await POST(request({
      id: 'event-test-1',
      type: 'webhook.test',
      data: {},
    }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, test: true })
    expect(mocks.admin.from).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('accepts the documented nested signing-request payload and claims its event id', async () => {
    const response = await POST(request({
      id: 'event-1',
      type: 'signing_request.updated',
      data: { signing_request: { id: 'request-1' }, recipients: [] },
    }))

    expect(response.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('claim_firma_webhook_event', {
      p_event_id: 'event-1',
      p_firma_request_id: 'request-1',
      p_event_type: 'signing_request.updated',
      p_payload: expect.any(Object),
      p_agreement_id: 'agreement-1',
    })
    expect(mocks.getEnvelopeState).toHaveBeenCalledWith('request-1')
  })

  it('returns non-2xx while an event is in progress so Firma retries it', async () => {
    mocks.state.claimStatus = 'in_progress'

    const response = await POST(request({
      id: 'event-2',
      type: 'signing_request.completed',
      data: { signing_request: { id: 'request-1' } },
    }))

    expect(response.status).toBe(503)
    expect(mocks.getEnvelopeState).not.toHaveBeenCalled()
  })

  it('claims legacy matter envelopes too and acknowledges only processed duplicates', async () => {
    mocks.state.agreement = null
    mocks.state.details = {
      client_id: 'matter-1',
      engagement_status: 'sent',
      engagement_signed: false,
    }
    mocks.state.claimStatus = 'duplicate'

    const response = await POST(request({
      id: 'event-3',
      type: 'signing_request.completed',
      data: { signing_request: { id: 'request-1' } },
    }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, duplicate: true })
    expect(mocks.rpc).toHaveBeenCalledWith(
      'claim_firma_webhook_event',
      expect.objectContaining({ p_agreement_id: null }),
    )
    expect(mocks.getEnvelopeState).not.toHaveBeenCalled()
  })

  it('records a retryable error when the signed PDF is not ready', async () => {
    mocks.getEnvelopeState.mockResolvedValue({
      status: 'signed',
      recipients: [],
      finalDocumentUrl: null,
    })

    const response = await POST(request({
      id: 'event-4',
      type: 'signing_request.completed',
      data: { signing_request: { id: 'request-1' } },
    }))

    expect(response.status).toBe(502)
    expect(mocks.state.updates).toContainEqual({
      table: 'firma_webhook_events',
      values: { error: 'signed document storage deferred' },
    })
  })
})
