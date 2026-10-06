import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IntegrationError } from '@/lib/integrations/errors'

const mocks = vi.hoisted(() => {
  const state = {
    events: [] as unknown[],
    eventById: {} as Record<string, unknown | 'missing'>,
    people: {} as Record<string, unknown>,
    outboundIds: [] as string[],
    prospectLeads: {} as Record<string, string>,
    leadMatters: {} as Record<string, string>,
    stored: [] as Array<Record<string, unknown>>,
    claimed: new Set<string>(),
    claimCalls: [] as string[],
  }

  function rowsFor(table: string, filters: Record<string, unknown>): unknown[] {
    if (table === 'integration_external_records') {
      if (filters.external_record_type === 'event') return state.outboundIds.map(external_id => ({ external_id }))
      const lead = state.prospectLeads[String(filters.external_id)]
      return lead ? [{ internal_entity_id: lead }] : []
    }
    if (table === 'client_intake') return []
    if (table === 'matters') {
      const matter = state.leadMatters[String(filters.client_intake_id)]
      return matter ? [{ id: matter }] : []
    }
    if (table === 'external_bookings') {
      const ids = filters.booking_uid as string[] | undefined
      const statuses = filters.status as string[] | undefined
      return state.stored.filter(row =>
        (!ids || ids.includes(row.booking_uid as string))
        && (!statuses || statuses.includes(row.status as string)))
    }
    return []
  }

  function from(table: string) {
    const filters: Record<string, unknown> = {}
    const chain: Record<string, unknown> = {}
    for (const method of ['select', 'not', 'gte', 'order', 'limit']) chain[method] = vi.fn(() => chain)
    chain.eq = vi.fn((column: string, value: unknown) => { filters[column] = value; return chain })
    chain.in = vi.fn((column: string, value: unknown) => { filters[column] = value; return chain })
    chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve({ data: rowsFor(table, filters), error: null }).then(resolve, reject)
    return chain
  }

  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    const key = String(args.p_event_id)
    if (fn === 'claim_webhook_event') {
      state.claimCalls.push(key)
      if (state.claimed.has(key)) return { data: false, error: null }
      state.claimed.add(key)
      return { data: true, error: null }
    }
    if (fn === 'release_webhook_event') state.claimed.delete(key)
    return { data: null, error: null }
  })

  const lawmaticsRequest = vi.fn(async (path: string) => {
    const url = new URL(`https://api.lawmatics.com${path}`)
    if (url.pathname === '/v1/events') {
      const page = Number(url.searchParams.get('page'))
      return page === 1 ? state.events : []
    }
    const eventMatch = url.pathname.match(/^\/v1\/events\/(.+)$/)
    if (eventMatch) {
      const found = state.eventById[decodeURIComponent(eventMatch[1])]
      if (!found || found === 'missing') {
        throw new IntegrationError({ provider: 'lawmatics', kind: 'attention', code: 'not_found', safeMessage: 'x', retryAfterMs: null })
      }
      return found
    }
    const person = state.people[url.pathname]
    if (!person) throw new IntegrationError({ provider: 'lawmatics', kind: 'attention', code: 'not_found', safeMessage: 'x', retryAfterMs: null })
    return person
  })

  return {
    state,
    rpc,
    lawmaticsRequest,
    processBookingEvent: vi.fn(async () => {}),
    getAdminClient: vi.fn(() => ({ from: vi.fn(from), rpc })),
  }
})

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: mocks.getAdminClient }))
vi.mock('@/lib/bookings/sync', () => ({ processBookingEvent: mocks.processBookingEvent }))
vi.mock('@/lib/integrations/lawmatics/client', () => ({ lawmaticsRequest: mocks.lawmaticsRequest }))
vi.mock('@/lib/integrations/settings', () => ({
  getIntegrationSettings: vi.fn(async () => ({ lawmaticsEventTypeIdMap: { discovery_call: 'et-discovery', pmps: 'et-pmps' } })),
}))
vi.mock('next/server', async importOriginal => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: vi.fn(async (task: () => Promise<void>) => { await task() }),
}))

import { parseLawmaticsEvent, syncLawmaticsCalendar } from '@/lib/integrations/lawmatics/inbound'
import { isFormSubmissionEvent, verifyLawmaticsSignature } from '@/lib/integrations/lawmatics/webhook'

const NOW = new Date('2026-10-01T12:00:00.000Z')

function lmEvent(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: 'event',
    attributes: {
      name: 'Discovery Call',
      description: 'Booked from the website',
      start_date: '2026-10-05T10:00:00-04:00',
      end_date: '2026-10-05T10:30:00-04:00',
      all_day: false,
      event_type_id: 'et-discovery',
      eventable_type: 'Prospect',
      eventable_id: 'p-1',
      ...overrides,
    },
  }
}

function stored(id: string, overrides: Record<string, unknown> = {}) {
  return {
    booking_uid: id,
    status: 'scheduled',
    start_time: '2026-10-05T14:00:00.000Z',
    end_time: '2026-10-05T14:30:00.000Z',
    event_key: 'discovery_call',
    event_label: 'Discovery Call',
    attendee_email: 'avery@example.com',
    attendee_name: 'Avery Stone',
    linked_lead_id: 'lead-1',
    updated_at: '2026-10-01T00:00:00.000Z',
    ...overrides,
  }
}

const calls = () => mocks.processBookingEvent.mock.calls.map(call => (call as unknown[])[0] as Record<string, unknown>)

beforeEach(() => {
  process.env.LAWMATICS_CALENDAR_SYNC_ENABLED = 'true'
  Object.assign(mocks.state, {
    events: [], eventById: {}, outboundIds: [], prospectLeads: { 'p-1': 'lead-1' }, leadMatters: {}, stored: [],
    claimed: new Set<string>(), claimCalls: [],
    people: { '/v1/prospects/p-1': { id: 'p-1', type: 'prospect', attributes: { first_name: 'Avery', last_name: 'Stone', email: 'Avery@Example.com', phone: '6175550100' } } },
  })
  mocks.processBookingEvent.mockReset()
  mocks.processBookingEvent.mockImplementation(async () => {})
})

afterEach(() => {
  delete process.env.LAWMATICS_CALENDAR_SYNC_ENABLED
  delete process.env.LAWMATICS_WEBHOOK_SECRET
})

describe('parseLawmaticsEvent', () => {
  it('reads attribute-style events and normalizes times to UTC', () => {
    expect(parseLawmaticsEvent(lmEvent('e-1'))).toEqual({
      id: 'e-1',
      name: 'Discovery Call',
      description: 'Booked from the website',
      start: '2026-10-05T14:00:00.000Z',
      end: '2026-10-05T14:30:00.000Z',
      allDay: false,
      cancelled: false,
      eventTypeId: 'et-discovery',
      eventable: { type: 'prospect', id: 'p-1' },
    })
  })

  it('falls back to JSON:API relationships for the contact and event type', () => {
    const parsed = parseLawmaticsEvent({
      id: 42,
      attributes: { name: 'PMPS', start_date: '2026-10-06T15:00:00Z', end_date: '2026-10-06T16:00:00Z' },
      relationships: {
        eventable: { data: { type: 'contact', id: 'c-9' } },
        event_type: { data: { type: 'event_type', id: 'et-pmps' } },
      },
    })
    expect(parsed).toMatchObject({ id: '42', eventTypeId: 'et-pmps', eventable: { type: 'contact', id: 'c-9' } })
  })

  it('flags cancelled events and rejects unusable ones', () => {
    expect(parseLawmaticsEvent(lmEvent('e-1', { canceled_at: '2026-10-02T00:00:00Z' }))?.cancelled).toBe(true)
    expect(parseLawmaticsEvent(lmEvent('e-1', { status: 'Cancelled' }))?.cancelled).toBe(true)
    expect(parseLawmaticsEvent(lmEvent('e-1', { end_date: '2026-10-05T09:00:00-04:00' }))).toBeNull()
    expect(parseLawmaticsEvent({ attributes: {} })).toBeNull()
    expect(parseLawmaticsEvent(lmEvent('e-1', { eventable_type: 'User', eventable_id: 'u-1' }))?.eventable).toBeNull()
  })
})

describe('verifyLawmaticsSignature', () => {
  const secret = 'whsec_test'
  const rawBody = '{"event_id":"evt_1","event_type":"form.submitted"}'
  const timestamp = '1790000000'
  const signature = `sha256=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`

  it('accepts a correctly signed, fresh delivery', () => {
    expect(verifyLawmaticsSignature({ rawBody, secret, signature, timestamp, nowSeconds: 1790000100 })).toBe(true)
  })

  it('rejects a tampered body, wrong secret, stale timestamp, or missing prefix', () => {
    const base = { rawBody, secret, signature, timestamp, nowSeconds: 1790000100 }
    expect(verifyLawmaticsSignature({ ...base, rawBody: rawBody.replace('evt_1', 'evt_2') })).toBe(false)
    expect(verifyLawmaticsSignature({ ...base, secret: 'whsec_other' })).toBe(false)
    expect(verifyLawmaticsSignature({ ...base, nowSeconds: 1790000000 + 301 })).toBe(false)
    expect(verifyLawmaticsSignature({ ...base, signature: signature.slice('sha256='.length) })).toBe(false)
    expect(verifyLawmaticsSignature({ ...base, timestamp: null })).toBe(false)
  })

  it('recognizes form submission event types only', () => {
    expect(isFormSubmissionEvent('form.submitted')).toBe(true)
    expect(isFormSubmissionEvent('form_submission.created')).toBe(true)
    expect(isFormSubmissionEvent('matter.created')).toBe(false)
    expect(isFormSubmissionEvent(undefined)).toBe(false)
  })
})

describe('syncLawmaticsCalendar', () => {
  it('does nothing unless LAWMATICS_CALENDAR_SYNC_ENABLED is true', async () => {
    delete process.env.LAWMATICS_CALENDAR_SYNC_ENABLED
    expect(await syncLawmaticsCalendar({ now: NOW })).toMatchObject({ skipped: 'disabled' })
    expect(mocks.lawmaticsRequest).not.toHaveBeenCalledWith(expect.stringContaining('/v1/events'), expect.anything())
  })

  it('mirrors a new client booking, linked to the lead and meeting type', async () => {
    mocks.state.events = [lmEvent('e-1')]
    const result = await syncLawmaticsCalendar({ now: NOW })

    expect(result).toMatchObject({ scanned: 1, mirrored: 1, failed: 0 })
    expect(calls()).toEqual([expect.objectContaining({
      provider: 'lawmatics',
      providerLabel: 'Lawmatics',
      action: 'created',
      status: 'scheduled',
      bookingUid: 'e-1',
      attendeeEmail: 'avery@example.com',
      attendeeName: 'Avery Stone',
      attendeePhone: '6175550100',
      eventKey: 'discovery_call',
      eventLabel: 'Discovery Call',
      startTime: '2026-10-05T14:00:00.000Z',
      endTime: '2026-10-05T14:30:00.000Z',
      metadataLeadId: 'lead-1',
      metadataMatterId: null,
    })])
  })

  it('links a booking on a pushed prospect to the lead\'s matter too', async () => {
    mocks.state.leadMatters = { 'lead-1': 'matter-1' }
    mocks.state.events = [lmEvent('e-1')]
    await syncLawmaticsCalendar({ now: NOW })
    expect(calls()).toEqual([expect.objectContaining({ metadataLeadId: 'lead-1', metadataMatterId: 'matter-1' })])
  })

  it('skips events Cornerstone pushed, internal/all-day events, and events outside the window', async () => {
    mocks.state.outboundIds = ['e-pushed']
    mocks.state.events = [
      lmEvent('e-pushed'),
      lmEvent('e-marker', { description: 'Cornerstone appointment reference: 123' }),
      lmEvent('e-allday', { all_day: true }),
      lmEvent('e-staff', { eventable_type: 'User', eventable_id: 'u-1' }),
      lmEvent('e-old', { start_date: '2026-09-01T10:00:00Z', end_date: '2026-09-01T11:00:00Z' }),
    ]
    const result = await syncLawmaticsCalendar({ now: NOW })
    expect(result).toMatchObject({ scanned: 5, ignored: 5, mirrored: 0 })
    expect(mocks.processBookingEvent).not.toHaveBeenCalled()
  })

  it('leaves unchanged bookings alone and records a moved one as rescheduled', async () => {
    mocks.state.events = [
      lmEvent('e-same'),
      lmEvent('e-moved', { start_date: '2026-10-07T10:00:00-04:00', end_date: '2026-10-07T11:00:00-04:00' }),
    ]
    mocks.state.stored = [stored('e-same'), stored('e-moved')]
    const result = await syncLawmaticsCalendar({ now: NOW })

    expect(result).toMatchObject({ mirrored: 1 })
    expect(calls()).toEqual([expect.objectContaining({
      bookingUid: 'e-moved', action: 'rescheduled', status: 'rescheduled', startTime: '2026-10-07T14:00:00.000Z',
    })])
  })

  it('cancels an upcoming mirrored booking whose Lawmatics event was deleted', async () => {
    mocks.state.stored = [stored('e-gone'), stored('e-live')]
    mocks.state.eventById = { 'e-gone': 'missing', 'e-live': lmEvent('e-live', { start_date: '2027-06-01T10:00:00Z', end_date: '2027-06-01T11:00:00Z' }) }
    const result = await syncLawmaticsCalendar({ now: NOW })

    expect(result).toMatchObject({ cancelled: 1, failed: 0 })
    expect(calls()).toEqual([expect.objectContaining({
      bookingUid: 'e-gone', action: 'cancelled', status: 'cancelled', attendeeEmail: 'avery@example.com', metadataLeadId: 'lead-1',
    })])
  })

  it('processes each observed change once across overlapping runs', async () => {
    mocks.state.events = [lmEvent('e-1')]
    await syncLawmaticsCalendar({ now: NOW })
    await syncLawmaticsCalendar({ now: NOW })
    expect(mocks.processBookingEvent).toHaveBeenCalledTimes(1)
  })

  it('releases the claim when recording fails so the next run retries', async () => {
    mocks.state.events = [lmEvent('e-1')]
    mocks.processBookingEvent.mockRejectedValueOnce(new Error('db down'))
    expect(await syncLawmaticsCalendar({ now: NOW })).toMatchObject({ failed: 1, mirrored: 0 })
    expect(await syncLawmaticsCalendar({ now: NOW })).toMatchObject({ failed: 0, mirrored: 1 })
  })

  it('skips contacts with no email instead of failing the run', async () => {
    mocks.state.events = [lmEvent('e-1')]
    mocks.state.people['/v1/prospects/p-1'] = { id: 'p-1', attributes: { first_name: 'No', last_name: 'Email' } }
    expect(await syncLawmaticsCalendar({ now: NOW })).toMatchObject({ ignored: 1, failed: 0, mirrored: 0 })
  })

  it('reports not_connected when Lawmatics is not authorized', async () => {
    mocks.lawmaticsRequest.mockRejectedValueOnce(new IntegrationError({
      provider: 'lawmatics', kind: 'attention', code: 'authentication_required', safeMessage: 'x', retryAfterMs: null,
    }))
    expect(await syncLawmaticsCalendar({ now: NOW })).toMatchObject({ skipped: 'not_connected' })
  })
})

describe('POST /api/webhooks/lawmatics', () => {
  const secret = 'whsec_route'

  function signed(body: Record<string, unknown>, opts: { secret?: string } = {}) {
    const raw = JSON.stringify(body)
    const timestamp = String(Math.floor(Date.now() / 1000))
    const signature = `sha256=${createHmac('sha256', opts.secret ?? secret).update(`${timestamp}.${raw}`).digest('hex')}`
    return new Request('http://localhost/api/webhooks/lawmatics', {
      method: 'POST',
      headers: { 'x-lawmatics-signature': signature, 'x-lawmatics-timestamp': timestamp },
      body: raw,
    })
  }

  async function post(request: Request) {
    const { POST } = await import('../app/api/webhooks/lawmatics/route')
    const response = await POST(request)
    return { status: response.status, body: await response.json() }
  }

  it('refuses deliveries until the secret is configured, and bad signatures', async () => {
    expect((await post(signed({ event_type: 'form.submitted' }))).status).toBe(503)
    process.env.LAWMATICS_WEBHOOK_SECRET = secret
    expect((await post(signed({ event_type: 'form.submitted' }, { secret: 'whsec_wrong' }))).status).toBe(401)
  })

  it('ignores non-form events without touching the Lawmatics API', async () => {
    process.env.LAWMATICS_WEBHOOK_SECRET = secret
    const { status, body } = await post(signed({ event_id: 'evt_m', event_type: 'matter.created' }))
    expect(status).toBe(200)
    expect(body).toEqual({ received: true, ignored: 'matter.created' })
    expect(mocks.lawmaticsRequest).not.toHaveBeenCalled()
  })

  it('runs the calendar import on a form submission, once per Lawmatics event_id', async () => {
    process.env.LAWMATICS_WEBHOOK_SECRET = secret
    mocks.state.events = [lmEvent('e-1')]
    // The route imports with the real clock, and the import keeps only events
    // ending within the last day. The fixture event is fixed in October 2026,
    // so once the calendar passed it this test started failing on every
    // branch. Pin the clock (Date only; timers stay real for waitFor) to the
    // same NOW the sync tests use.
    vi.useFakeTimers({ toFake: ['Date'], now: NOW })
    try {
      const first = await post(signed({ event_id: 'evt_1', event_type: 'form.submitted', data: {} }))
      expect(first).toEqual({ status: 200, body: { received: true } })
      // The import runs in after(), once the response is sent.
      await vi.waitFor(() => expect(calls()).toEqual([expect.objectContaining({ bookingUid: 'e-1', action: 'created' })]))

      const again = await post(signed({ event_id: 'evt_1', event_type: 'form.submitted', data: {} }))
      expect(again.body).toEqual({ received: true, duplicate: true })
    } finally {
      vi.useRealTimers()
    }
  })
})

afterEach(() => {
  mocks.lawmaticsRequest.mockClear()
})
