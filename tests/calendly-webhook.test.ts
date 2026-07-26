import { createHmac } from 'crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const MATTER_ID = '123e4567-e89b-12d3-a456-426614174000'

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
    claimedEvents.clear()
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

  // Model the idempotency ledger faithfully: first claim wins, repeats lose.
  const claimedEvents = new Set<string>()

  const getAdminClient = vi.fn(() => ({
    from: vi.fn((table: string) => builderFor(table)),
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      const key = `${args.p_provider}:${args.p_event_id}`
      if (fn === 'claim_webhook_event') {
        if (claimedEvents.has(key)) return { data: false, error: null }
        claimedEvents.add(key)
        return { data: true, error: null }
      }
      if (fn === 'release_webhook_event') {
        claimedEvents.delete(key)
        return { data: null, error: null }
      }
      return { data: null, error: null }
    }),
  }))

  resetState()

  return { state, resetState, getAdminClient }
})

vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: routeMocks.getAdminClient,
}))

const originalSigningKey = process.env.CALENDLY_WEBHOOK_SIGNING_KEY
const originalEventTypeMap = process.env.CALENDLY_EVENT_TYPE_MAP

beforeEach(() => {
  routeMocks.resetState()
  routeMocks.getAdminClient.mockClear()
  process.env.CALENDLY_WEBHOOK_SIGNING_KEY = 'test-signing-key'
  process.env.CALENDLY_EVENT_TYPE_MAP = JSON.stringify({
    'et-signing': 'signing_appointment',
    'et-discovery': 'discovery_call',
  })
})

afterEach(() => {
  if (originalSigningKey === undefined) {
    delete process.env.CALENDLY_WEBHOOK_SIGNING_KEY
  } else {
    process.env.CALENDLY_WEBHOOK_SIGNING_KEY = originalSigningKey
  }
  if (originalEventTypeMap === undefined) {
    delete process.env.CALENDLY_EVENT_TYPE_MAP
  } else {
    process.env.CALENDLY_EVENT_TYPE_MAP = originalEventTypeMap
  }
})

function calendlyBody(input: {
  event?: 'invitee.created' | 'invitee.canceled'
  inviteeUuid?: string
  eventTypeUuid?: string
  eventName?: string
  email?: string
  name?: string
  startTime?: string
  endTime?: string
  rescheduled?: boolean
  oldInvitee?: string
  utmContent?: string
}): Record<string, unknown> {
  const inviteeUuid = input.inviteeUuid ?? 'inv-1'
  return {
    event: input.event ?? 'invitee.created',
    created_at: '2026-06-01T12:00:00.000Z',
    payload: {
      uri: `https://api.calendly.com/scheduled_events/ev-1/invitees/${inviteeUuid}`,
      email: input.email ?? 'avery@example.com',
      name: input.name ?? 'Avery Stone',
      status: input.event === 'invitee.canceled' ? 'canceled' : 'active',
      rescheduled: input.rescheduled ?? false,
      old_invitee: input.oldInvitee
        ? `https://api.calendly.com/scheduled_events/ev-0/invitees/${input.oldInvitee}`
        : null,
      new_invitee: null,
      scheduled_event: {
        uri: 'https://api.calendly.com/scheduled_events/ev-1',
        name: input.eventName ?? 'Signing Appointment',
        status: 'active',
        start_time: input.startTime ?? '2026-06-10T14:00:00.000000Z',
        end_time: input.endTime ?? '2026-06-10T15:00:00.000000Z',
        event_type: `https://api.calendly.com/event_types/${input.eventTypeUuid ?? 'et-signing'}`,
      },
      tracking: input.utmContent ? { utm_content: input.utmContent } : {},
    },
  }
}

function signedRequest(
  body: Record<string, unknown>,
  opts?: { t?: number; badSignature?: boolean; omitSignature?: boolean },
) {
  const raw = JSON.stringify(body)
  const t = opts?.t ?? Math.floor(Date.now() / 1000)
  const v1 = opts?.badSignature
    ? 'deadbeef'
    : createHmac('sha256', process.env.CALENDLY_WEBHOOK_SIGNING_KEY!)
        .update(`${t}.${raw}`)
        .digest('hex')
  return new Request('http://localhost/api/webhooks/calendly', {
    method: 'POST',
    headers: opts?.omitSignature ? {} : { 'calendly-webhook-signature': `t=${t},v1=${v1}` },
    body: raw,
  })
}

async function postWebhook(
  body: Record<string, unknown>,
  opts?: { t?: number; badSignature?: boolean; omitSignature?: boolean },
) {
  vi.resetModules()
  const { POST } = await import('../app/api/webhooks/calendly/route')
  const response = await POST(signedRequest(body, opts))
  return {
    response,
    body: await response.json(),
  }
}

describe('Calendly webhook sync', () => {
  it('returns 503 when the signing key is not configured', async () => {
    delete process.env.CALENDLY_WEBHOOK_SIGNING_KEY
    vi.resetModules()
    const { POST } = await import('../app/api/webhooks/calendly/route')
    const response = await POST(new Request('http://localhost/api/webhooks/calendly', {
      method: 'POST',
      body: JSON.stringify(calendlyBody({})),
    }))
    expect(response.status).toBe(503)
  })

  it('rejects requests without a signature', async () => {
    const { response } = await postWebhook(calendlyBody({}), { omitSignature: true })
    expect(response.status).toBe(401)
    expect(routeMocks.state.upserts).toHaveLength(0)
  })

  it('rejects requests with an invalid signature', async () => {
    const { response } = await postWebhook(calendlyBody({}), { badSignature: true })
    expect(response.status).toBe(401)
    expect(routeMocks.state.upserts).toHaveLength(0)
  })

  it('rejects requests with a stale timestamp even when the HMAC is valid', async () => {
    const staleT = Math.floor(Date.now() / 1000) - 600
    const { response } = await postWebhook(calendlyBody({}), { t: staleT })
    expect(response.status).toBe(401)
    expect(routeMocks.state.upserts).toHaveLength(0)
  })

  it('mirrors a matter booking by utm tracking and updates the signing date', async () => {
    const { response } = await postWebhook(calendlyBody({
      utmContent: `matterId:${MATTER_ID}`,
    }))

    expect(response.status).toBe(200)
    expect(routeMocks.state.upserts).toContainEqual(expect.objectContaining({
      table: 'external_bookings',
      values: expect.objectContaining({
        provider: 'calendly',
        booking_uid: 'inv-1',
        trigger_event: 'invitee.created',
        event_key: 'signing_appointment',
        status: 'scheduled',
        linked_matter_id: MATTER_ID,
        unresolved_reason: null,
      }),
      options: { onConflict: 'provider,booking_uid' },
    }))
    expect(routeMocks.state.upserts).toContainEqual(expect.objectContaining({
      table: 'matter_details',
      values: { client_id: MATTER_ID, scheduled_signing_date: '2026-06-10T14:00:00.000Z' },
    }))
    expect(routeMocks.state.inserts).toContainEqual(expect.objectContaining({
      table: 'matter_notes',
      values: expect.objectContaining({
        matter_id: MATTER_ID,
        note_type: 'internal',
        author: 'System',
        calcom_booking_uid: 'inv-1',
      }),
    }))
  })

  it('creates a lead for a discovery booking with no existing match', async () => {
    await postWebhook(calendlyBody({
      inviteeUuid: 'inv-2',
      eventTypeUuid: 'et-discovery',
      eventName: 'Discovery Call',
      email: 'unknown@example.com',
      name: 'Unknown Person',
    }))

    expect(routeMocks.state.inserts).toContainEqual(expect.objectContaining({
      table: 'client_intake',
      values: expect.objectContaining({
        first_name: 'Unknown',
        last_name: 'Person',
        email: 'unknown@example.com',
        lead_source: 'calendly',
        lead_status: 'lead',
      }),
    }))
    expect(routeMocks.state.inserts).toContainEqual(expect.objectContaining({
      table: 'lead_activity',
      values: expect.objectContaining({
        lead_id: 'client_intake-1',
        event_type: 'created',
        title: 'Lead created from Calendly',
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

  it('records a rescheduled booking for the new invitee', async () => {
    await postWebhook(calendlyBody({
      inviteeUuid: 'inv-new',
      eventTypeUuid: 'et-discovery',
      eventName: 'Discovery Call',
      oldInvitee: 'inv-old',
      startTime: '2026-06-12T16:00:00.000000Z',
    }))

    expect(routeMocks.state.upserts).toContainEqual(expect.objectContaining({
      table: 'external_bookings',
      values: expect.objectContaining({
        provider: 'calendly',
        booking_uid: 'inv-new',
        status: 'rescheduled',
        linked_lead_id: 'lead-1',
      }),
    }))
    // Reschedules never auto-create leads (parity with Cal.com BOOKING_CREATED-only).
    expect(routeMocks.state.inserts.some(item => item.table === 'client_intake')).toBe(false)
    expect(routeMocks.state.inserts).toContainEqual(expect.objectContaining({
      table: 'lead_activity',
      values: expect.objectContaining({
        lead_id: 'lead-1',
        event_type: 'consult_scheduled',
        title: expect.stringContaining('Rescheduled'),
      }),
    }))
  })

  it('marks the old invitee superseded on cancel-for-reschedule with no fan-out', async () => {
    await postWebhook(calendlyBody({
      event: 'invitee.canceled',
      inviteeUuid: 'inv-old',
      eventTypeUuid: 'et-discovery',
      eventName: 'Discovery Call',
      rescheduled: true,
    }))

    expect(routeMocks.state.upserts).toContainEqual(expect.objectContaining({
      table: 'external_bookings',
      values: expect.objectContaining({
        provider: 'calendly',
        booking_uid: 'inv-old',
        status: 'superseded',
      }),
    }))
    // The paired invitee.created carries the real state; the superseded row
    // must not produce cancellation activity, notes, or date updates.
    expect(routeMocks.state.inserts).toHaveLength(0)
    expect(routeMocks.state.upserts.some(item => item.table === 'matter_details')).toBe(false)
  })

  it('records a genuine cancellation with lead activity', async () => {
    await postWebhook(calendlyBody({
      event: 'invitee.canceled',
      inviteeUuid: 'inv-3',
      eventTypeUuid: 'et-discovery',
      eventName: 'Discovery Call',
    }))

    expect(routeMocks.state.upserts).toContainEqual(expect.objectContaining({
      table: 'external_bookings',
      values: expect.objectContaining({
        booking_uid: 'inv-3',
        status: 'cancelled',
      }),
    }))
    expect(routeMocks.state.inserts).toContainEqual(expect.objectContaining({
      table: 'lead_activity',
      values: expect.objectContaining({
        lead_id: 'lead-1',
        event_type: 'note',
        title: 'Appointment cancelled',
      }),
    }))
    // Cancellations never auto-create leads.
    expect(routeMocks.state.inserts.some(item => item.table === 'client_intake')).toBe(false)
  })

  it('stores unmatched matter-style bookings without creating leads', async () => {
    await postWebhook(calendlyBody({
      inviteeUuid: 'inv-4',
      email: 'unknown@example.com',
      name: 'Unknown Person',
    }))

    expect(routeMocks.state.upserts).toContainEqual(expect.objectContaining({
      table: 'external_bookings',
      values: expect.objectContaining({
        booking_uid: 'inv-4',
        linked_lead_id: null,
        linked_matter_id: null,
        unresolved_reason: 'no_match',
      }),
    }))
    expect(routeMocks.state.inserts.some(item => item.table === 'client_intake')).toBe(false)
    expect(routeMocks.state.inserts.some(item => item.table === 'lead_activity')).toBe(false)
  })

  it('resolves the meeting type by event name when the map env is unset', async () => {
    delete process.env.CALENDLY_EVENT_TYPE_MAP
    await postWebhook(calendlyBody({
      inviteeUuid: 'inv-5',
      eventTypeUuid: 'et-unmapped',
      eventName: 'Discovery Call',
      email: 'unknown@example.com',
      name: 'Unknown Person',
    }))

    expect(routeMocks.state.upserts).toContainEqual(expect.objectContaining({
      table: 'external_bookings',
      values: expect.objectContaining({
        booking_uid: 'inv-5',
        event_key: 'discovery_call',
      }),
    }))
    expect(routeMocks.state.inserts).toContainEqual(expect.objectContaining({
      table: 'client_intake',
      values: expect.objectContaining({ lead_source: 'calendly' }),
    }))
  })

  it('suppresses an identical redelivery via the idempotency claim', async () => {
    const body = calendlyBody({ inviteeUuid: 'inv-6' })
    await postWebhook(body)
    const upsertsAfterFirst = routeMocks.state.upserts.length

    const { body: second } = await postWebhook(body)
    expect(second.duplicate).toBe(true)
    expect(routeMocks.state.upserts.length).toBe(upsertsAfterFirst)
  })
})
