import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Executed-handler tests for the two webhook idempotency fixes. These call the
 * real route handlers rather than matching source strings, so they fail if the
 * claim is dropped or the merge moves back into JS.
 */

const rpc = vi.fn()
const from = vi.fn()

vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({ rpc, from }),
  ADMIN_EMAIL: 'admin@example.invalid',
}))

vi.mock('@/lib/calcom/verify', () => ({ verifyCalcomSignature: () => true }))

const processCalcomWebhook = vi.fn()
vi.mock('@/lib/calcom/sync', () => ({ processCalcomWebhook: (...a: unknown[]) => processCalcomWebhook(...a) }))

const notifyRetellCallAnalyzed = vi.fn()
vi.mock('@/lib/retell/notify', () => ({
  notifyRetellCallAnalyzed: (...a: unknown[]) => notifyRetellCallAnalyzed(...a),
  retellRowToNotifyInput: (row: unknown) => row,
}))

vi.mock('@/lib/retell/verify', () => ({ verifyRetellSignature: () => true }))

function calcomBody(overrides: Record<string, unknown> = {}) {
  return {
    triggerEvent: 'BOOKING_CREATED',
    createdAt: '2026-09-01T13:00:00Z',
    payload: {
      uid: 'bk-1',
      bookingId: 1,
      startTime: '2026-09-01T14:00:00Z',
      endTime: '2026-09-01T14:30:00Z',
      type: 'discovery-call',
      title: 'Discovery Call',
      attendees: [{ email: 'client@example.invalid', name: 'Client' }],
      metadata: {},
      ...(overrides.payload as Record<string, unknown> ?? {}),
    },
    ...overrides,
  }
}

function calcomRequest(body: unknown) {
  return new Request('https://app.test/api/webhooks/calcom', {
    method: 'POST',
    headers: { 'x-cal-signature-256': 'sig', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  process.env.CALCOM_WEBHOOK_SECRET = 'test-secret'
  process.env.RETELL_API_KEY = 'test-key'
  rpc.mockReset()
  from.mockReset()
  processCalcomWebhook.mockReset().mockResolvedValue(undefined)
  notifyRetellCallAnalyzed.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('Cal.com webhook idempotency', () => {
  it('processes an event it successfully claims', async () => {
    rpc.mockResolvedValue({ data: true, error: null })
    const { POST } = await import('@/app/api/webhooks/calcom/route')

    const res = await POST(calcomRequest(calcomBody()))

    expect(res.status).toBe(200)
    expect(processCalcomWebhook).toHaveBeenCalledTimes(1)
    const [fn, args] = rpc.mock.calls[0]
    expect(fn).toBe('claim_webhook_event')
    expect(args.p_provider).toBe('calcom')
    // Keyed on booking + trigger + start time so a real reschedule is not suppressed.
    expect(args.p_event_id).toContain('BOOKING_CREATED')
  })

  it('skips processing when the claim is lost (duplicate delivery)', async () => {
    rpc.mockResolvedValue({ data: false, error: null })
    const { POST } = await import('@/app/api/webhooks/calcom/route')

    const res = await POST(calcomRequest(calcomBody()))
    const json = await res.json()

    // Cal.com retries on any non-2xx, and processCalcomWebhook inserts matter
    // notes + lead activity unconditionally, so a duplicate must be a no-op.
    expect(res.status).toBe(200)
    expect(json.duplicate).toBe(true)
    expect(processCalcomWebhook).not.toHaveBeenCalled()
  })

  it('releases the claim when processing throws, so a retry can reprocess', async () => {
    rpc.mockImplementation((fn: string) =>
      fn === 'claim_webhook_event'
        ? Promise.resolve({ data: true, error: null })
        : Promise.resolve({ data: null, error: null }),
    )
    processCalcomWebhook.mockRejectedValue(new Error('downstream boom'))
    const { POST } = await import('@/app/api/webhooks/calcom/route')

    const res = await POST(calcomRequest(calcomBody()))

    expect(res.status).toBe(500)
    const released = rpc.mock.calls.find(([fn]) => fn === 'release_webhook_event')
    expect(released).toBeTruthy()
    expect(released?.[1].p_provider).toBe('calcom')
  })

  it('fails loudly when the claim itself errors, rather than skipping the booking', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'claim exploded' } })
    const { POST } = await import('@/app/api/webhooks/calcom/route')

    const res = await POST(calcomRequest(calcomBody()))

    expect(res.status).toBe(500)
    expect(processCalcomWebhook).not.toHaveBeenCalled()
  })
})

describe('Retell webhook call merge', () => {
  function retellRequest(event: string, call: Record<string, unknown>) {
    return new Request('https://app.test/api/webhooks/retell', {
      method: 'POST',
      headers: { 'x-retell-signature': 'sig', 'content-type': 'application/json' },
      body: JSON.stringify({ event, call }),
    })
  }

  const baseCall = {
    call_id: 'call-1',
    direction: 'inbound',
    from_number: '+15550001111',
    to_number: '+15550002222',
    call_status: 'ended',
  }

  it('merges through the RPC instead of read-modify-write', async () => {
    rpc.mockResolvedValue({
      data: [{ matter_id: null, lead_id: null, previous_summary: null, conflict: false }],
      error: null,
    })
    const { POST } = await import('@/app/api/webhooks/retell/route')

    const res = await POST(retellRequest('call_ended', baseCall))

    expect(res.status).toBe(200)
    const [fn, args] = rpc.mock.calls[0]
    expect(fn).toBe('upsert_retell_call')
    expect(args.p_call.external_call_id).toBe('call-1')
    // The old code SELECTed the row first and merged in JS; that read is what
    // went stale between two concurrent events.
    expect(from).not.toHaveBeenCalledWith('calls')
  })

  it('returns 409 when another provider owns the call id', async () => {
    rpc.mockResolvedValue({
      data: [{ matter_id: null, lead_id: null, previous_summary: null, conflict: true }],
      error: null,
    })
    const { POST } = await import('@/app/api/webhooks/retell/route')

    const res = await POST(retellRequest('call_ended', baseCall))

    expect(res.status).toBe(409)
  })

  it('passes the pre-write summary to the notifier on call_analyzed', async () => {
    rpc.mockResolvedValue({
      data: [{ matter_id: 'm1', lead_id: null, previous_summary: 'older summary', conflict: false }],
      error: null,
    })
    from.mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { summary: 'new summary' }, error: null }) }) }),
    })
    const { POST } = await import('@/app/api/webhooks/retell/route')

    const res = await POST(retellRequest('call_analyzed', { ...baseCall, call_analysis: { call_summary: 'new summary' } }))

    expect(res.status).toBe(200)
    expect(notifyRetellCallAnalyzed).toHaveBeenCalledTimes(1)
    const [, opts] = notifyRetellCallAnalyzed.mock.calls[0]
    expect(opts.previousSummary).toBe('older summary')
  })
})
