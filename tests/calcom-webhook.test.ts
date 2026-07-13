import { createHmac } from 'crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const routeMocks = vi.hoisted(() => {
  const state: {
    leads: Record<string, Record<string, unknown>>
    intakeMatches: Array<{ id: string }>
    matterMatches: Array<{ id: string }>
    upserts: Array<{ table: string; values: Record<string, unknown>; options?: unknown }>
    inserts: Array<{ table: string; values: Record<string, unknown> }>
    updates: Array<{ table: string; values: Record<string, unknown> }>
  } = {
    leads: {},
    intakeMatches: [],
    matterMatches: [],
    upserts: [],
    inserts: [],
    updates: [],
  }

  function resetState() {
    state.leads = {
      'lead-1': {
        id: 'lead-1',
        first_name: 'Avery',
        last_name: 'Stone',
        email: 'avery@example.com',
        lead_status: 'lead',
      },
    }
    state.intakeMatches = []
    state.matterMatches = []
    state.upserts = []
    state.inserts = []
    state.updates = []
  }

  function builderFor(table: string) {
    const filters: Record<string, unknown> = {}
    const builder: Record<string, unknown> = {}

    builder.select = vi.fn(() => builder)
    builder.eq = vi.fn((column: string, value: unknown) => {
      filters[column] = value
      return builder
    })
    builder.ilike = vi.fn((column: string, value: unknown) => {
      filters[column] = value
      return builder
    })
    builder.in = vi.fn((column: string, value: unknown) => {
      filters[column] = value
      return builder
    })
    builder.not = vi.fn(() => builder)
    builder.neq = vi.fn(() => builder)
    builder.order = vi.fn(() => builder)
    builder.limit = vi.fn(() => ({
      maybeSingle: builder.maybeSingle,
      then(
        onFulfilled?: (value: { data: unknown; error: null }) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) {
        const data = table === 'client_intake'
          ? state.intakeMatches
          : table === 'matters'
            ? state.matterMatches
            : []
        return Promise.resolve({ data, error: null }).then(onFulfilled, onRejected)
      },
    }))
    builder.maybeSingle = vi.fn(async () => {
      if (table === 'client_intake') {
        const id = filters.id as string | undefined
        const email = filters.email as string | undefined
        const lead = id
          ? state.leads[id] ?? null
          : Object.values(state.leads).find(item => item.email === email) ?? null
        return { data: lead, error: null }
      }
      if (table === 'matters') {
        const id = filters.id as string | undefined
        return { data: id ? { id } : null, error: null }
      }
      return { data: null, error: null }
    })
    builder.upsert = vi.fn((values: Record<string, unknown>, options?: unknown) => {
      state.upserts.push({ table, values, options })
      return {
        select: vi.fn(() => ({
          single: vi.fn(async () => ({ data: values, error: null })),
        })),
      }
    })
    builder.insert = vi.fn((values: Record<string, unknown>) => {
      state.inserts.push({ table, values })
      return {
        select: vi.fn(() => ({
          single: vi.fn(async () => ({ data: { id: `${table}-1`, ...values }, error: null })),
        })),
      }
    })
    builder.update = vi.fn((values: Record<string, unknown>) => {
      state.updates.push({ table, values })
      return {
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(async () => ({ data: values, error: null })),
          })),
        })),
      }
    })

    return builder
  }

  const getAdminClient = vi.fn(() => ({
    from: vi.fn((table: string) => builderFor(table)),
  }))

  resetState()

  return { state, resetState, getAdminClient }
})

vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: routeMocks.getAdminClient,
}))

const originalSecret = process.env.CALCOM_WEBHOOK_SECRET

beforeEach(() => {
  routeMocks.resetState()
  routeMocks.getAdminClient.mockClear()
  process.env.CALCOM_WEBHOOK_SECRET = 'test-secret'
})

function signedRequest(body: Record<string, unknown>) {
  const raw = JSON.stringify(body)
  const sig = createHmac('sha256', process.env.CALCOM_WEBHOOK_SECRET!).update(raw).digest('hex')
  return new Request('http://localhost/api/webhooks/calcom', {
    method: 'POST',
    headers: { 'x-cal-signature-256': sig },
    body: raw,
  })
}

async function postWebhook(body: Record<string, unknown>) {
  vi.resetModules()
  const { POST } = await import('../app/api/webhooks/calcom/route')
  const response = await POST(signedRequest(body))
  return {
    response,
    body: await response.json(),
  }
}

describe('Cal.com webhook sync', () => {
  it('requires signatures for booking mutations', async () => {
    vi.resetModules()
    const { POST } = await import('../app/api/webhooks/calcom/route')
    const response = await POST(new Request('http://localhost/api/webhooks/calcom', {
      method: 'POST',
      body: JSON.stringify({ triggerEvent: 'BOOKING_CREATED', payload: {} }),
    }))

    expect(response.status).toBe(401)
  })

  it('returns 503 when webhook secret is not configured', async () => {
    delete process.env.CALCOM_WEBHOOK_SECRET
    vi.resetModules()
    const { POST } = await import('../app/api/webhooks/calcom/route')
    const response = await POST(new Request('http://localhost/api/webhooks/calcom', {
      method: 'POST',
      body: JSON.stringify({ triggerEvent: 'BOOKING_CREATED', payload: { uid: 'booking-0' } }),
    }))
    expect(response.status).toBe(503)
  })

  it('mirrors a matter booking by metadata and updates signing dates idempotently', async () => {
    await postWebhook({
      triggerEvent: 'BOOKING_CREATED',
      payload: {
        uid: 'booking-1',
        type: 'signing-appointment',
        title: 'Signing Appointment',
        startTime: '2026-06-10T14:00:00.000Z',
        endTime: '2026-06-10T15:00:00.000Z',
        metadata: { matterId: 'matter-1', eventKey: 'signing_appointment', surface: 'matter' },
        attendees: [{ email: 'avery@example.com', name: 'Avery Stone' }],
      },
    })

    expect(routeMocks.state.upserts).toContainEqual(expect.objectContaining({
      table: 'calcom_bookings',
      values: expect.objectContaining({
        booking_uid: 'booking-1',
        event_key: 'signing_appointment',
        status: 'scheduled',
        linked_matter_id: 'matter-1',
        unresolved_reason: null,
      }),
    }))
    expect(routeMocks.state.upserts).toContainEqual(expect.objectContaining({
      table: 'matter_details',
      values: { client_id: 'matter-1', scheduled_signing_date: '2026-06-10' },
    }))
    expect(routeMocks.state.inserts).toContainEqual(expect.objectContaining({
      table: 'matter_notes',
      values: expect.objectContaining({
        matter_id: 'matter-1',
        note_type: 'internal',
        author: 'System',
        calcom_booking_uid: 'booking-1',
      }),
    }))
  })

  it('syncs lead bookings by metadata and records consult_scheduled activity', async () => {
    await postWebhook({
      triggerEvent: 'BOOKING_CREATED',
      payload: {
        uid: 'booking-2',
        type: 'discoverycall',
        title: 'Discovery Call',
        startTime: '2026-06-11T16:00:00.000Z',
        endTime: '2026-06-11T16:30:00.000Z',
        metadata: { leadId: 'lead-1', eventKey: 'discovery_call', surface: 'lead' },
        attendees: [{ email: 'avery@example.com', name: 'Avery Stone' }],
      },
    })

    expect(routeMocks.state.upserts).toContainEqual(expect.objectContaining({
      table: 'calcom_bookings',
      values: expect.objectContaining({
        booking_uid: 'booking-2',
        event_key: 'discovery_call',
        linked_lead_id: 'lead-1',
      }),
    }))
    expect(routeMocks.state.inserts).toContainEqual(expect.objectContaining({
      table: 'lead_activity',
      values: expect.objectContaining({
        lead_id: 'lead-1',
        event_type: 'consult_scheduled',
        title: expect.stringContaining('Discovery Call'),
      }),
    }))
    expect(routeMocks.state.updates.some(item => item.table === 'client_intake')).toBe(false)
  })

  it('creates a lead when a new lead-style booking has no reliable match', async () => {
    await postWebhook({
      triggerEvent: 'BOOKING_CREATED',
      payload: {
        uid: 'booking-3',
        type: 'discoverycall',
        title: 'Discovery Call',
        startTime: '2026-06-12T16:00:00.000Z',
        endTime: '2026-06-12T16:30:00.000Z',
        metadata: { eventKey: 'discovery_call', surface: 'portal' },
        attendees: [{ email: 'unknown@example.com', name: 'Unknown Person' }],
      },
    })

    expect(routeMocks.state.upserts).toContainEqual(expect.objectContaining({
      table: 'calcom_bookings',
      values: expect.objectContaining({
        booking_uid: 'booking-3',
        linked_lead_id: 'client_intake-1',
        linked_matter_id: null,
        unresolved_reason: null,
      }),
    }))
    expect(routeMocks.state.inserts).toContainEqual(expect.objectContaining({
      table: 'client_intake',
      values: expect.objectContaining({
        first_name: 'Unknown',
        last_name: 'Person',
        email: 'unknown@example.com',
        lead_source: 'calcom',
        lead_status: 'lead',
      }),
    }))
    expect(routeMocks.state.inserts).toContainEqual(expect.objectContaining({
      table: 'lead_activity',
      values: expect.objectContaining({
        lead_id: 'client_intake-1',
        event_type: 'created',
        title: 'Lead created from Cal.com',
      }),
    }))
    expect(routeMocks.state.inserts).toContainEqual(expect.objectContaining({
      table: 'lead_activity',
      values: expect.objectContaining({
        lead_id: 'client_intake-1',
        event_type: 'consult_scheduled',
      }),
    }))
  })

  it('stores unmatched matter-style bookings without creating leads', async () => {
    await postWebhook({
      triggerEvent: 'BOOKING_CREATED',
      payload: {
        uid: 'booking-4',
        type: 'signing-appointment',
        title: 'Signing Appointment',
        startTime: '2026-06-12T16:00:00.000Z',
        endTime: '2026-06-12T16:30:00.000Z',
        metadata: { eventKey: 'signing_appointment', surface: 'portal' },
        attendees: [{ email: 'unknown@example.com', name: 'Unknown Person' }],
      },
    })

    expect(routeMocks.state.upserts).toContainEqual(expect.objectContaining({
      table: 'calcom_bookings',
      values: expect.objectContaining({
        booking_uid: 'booking-4',
        linked_lead_id: null,
        linked_matter_id: null,
        unresolved_reason: 'no_match',
      }),
    }))
    expect(routeMocks.state.inserts.some(item => item.table === 'client_intake')).toBe(false)
    expect(routeMocks.state.inserts.some(item => item.table === 'lead_activity')).toBe(false)
  })
})

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.CALCOM_WEBHOOK_SECRET
  } else {
    process.env.CALCOM_WEBHOOK_SECRET = originalSecret
  }
})
