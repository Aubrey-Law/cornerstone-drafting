import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { AppointmentRow, AppointmentType } from '@/lib/appointments/types'
import type { Database } from '@/packages/db-types/src/supabase.generated'
import { NextRequest } from 'next/server'

vi.mock('server-only', () => ({}))

// ── shared mock state ────────────────────────────────────────────────────────

const state = vi.hoisted(() => ({
  inserts: [] as Array<{ table: string; values: Record<string, unknown> }>,
  updates: [] as Array<{ table: string; values: Record<string, unknown> }>,
  insertError: null as { code?: string; message?: string } | null,
  emails: [] as Array<{ category: string; to: string; subject: string; html?: string }>,
  createdEvents: [] as Array<Record<string, unknown>>,
  cancelledEvents: [] as string[],
  busy: [] as Array<{ start: number; end: number }>,
  lead: null as { id: string; lead_status: string } | null,
  matterId: null as string | null,
  // Backs any single-row select the booking path makes. Default matches most
  // tests, which don't care about the row's own id.
  matterLookup: { id: 'matter-1' } as { id: string } | null,
  paused: false,
  dateOverrides: {} as Record<string, Array<{ start: string; end: string }>>,
  automationCalls: [] as Array<Record<string, unknown>>,
  pmpsAnchors: [] as Array<Record<string, unknown>>,
  discoveryAnchors: [] as Array<Record<string, unknown>>,
  lawmaticsEnabled: false,
  statularEnabled: false,
  statularConfigError: false,
  statularAppointmentReadError: false,
  jobs: [] as Array<Record<string, unknown>>,
  enqueueError: false,
  claims: null as { id: string; email: string } | null,
  teamsCreated: [] as Array<Record<string, unknown>>,
  teamsDeleted: [] as string[],
  teamsRescheduled: [] as string[],
  teamsError: null as Error | null,
  reset() {
    this.teamsCreated = []
    this.teamsDeleted = []
    this.teamsRescheduled = []
    this.teamsError = null
    this.inserts = []
    this.updates = []
    this.insertError = null
    this.emails = []
    this.createdEvents = []
    this.cancelledEvents = []
    this.busy = []
    this.lead = null
    this.matterId = null
    this.matterLookup = { id: 'matter-1' }
    this.paused = false
    this.dateOverrides = {}
    this.automationCalls = []
    this.pmpsAnchors = []
    this.discoveryAnchors = []
    this.lawmaticsEnabled = false
    this.statularEnabled = false
    this.statularConfigError = false
    this.statularAppointmentReadError = false
    this.jobs = []
    this.enqueueError = false
    this.claims = null
  },
}))

vi.mock('@/lib/supabaseAdmin', () => {
  function builderFor(table: string) {
    return {
      insert: vi.fn((values: Record<string, unknown>) => {
        state.inserts.push({ table, values })
        const error = table === 'appointments' ? state.insertError : null
        const result = error
          ? { data: null, error }
          : { data: { id: `${table}-id-1`, lead_status: 'lead' }, error: null }
        return {
          select: vi.fn(() => ({ single: vi.fn(async () => result) })),
          then: (resolve: (v: unknown) => unknown) => resolve({ error: null }),
        }
      }),
      update: vi.fn((values: Record<string, unknown>) => {
        state.updates.push({ table, values })
        const chain = {
          eq: vi.fn(() => chain),
          is: vi.fn(() => chain),
          // markNoShow chains .select('id') straight off the update to check
          // a row actually matched the status filter.
          select: vi.fn(() => ({
            then: (resolve: (v: unknown) => unknown) =>
              resolve({ data: [{ id: `${table}-id-1` }], error: null }),
          })),
          then: (resolve: (v: unknown) => unknown) => resolve({ error: null }),
        }
        return chain
      }),
      upsert: vi.fn((values: Record<string, unknown>) => {
        state.inserts.push({ table: `${table}:upsert`, values })
        return { then: (resolve: (v: unknown) => unknown) => resolve({ error: null }) }
      }),
      select: vi.fn(() => {
        const chain = {
          eq: vi.fn(() => chain),
          order: vi.fn(() => chain),
          limit: vi.fn(() => chain),
          maybeSingle: vi.fn(async () => ({ data: table === 'integration_settings'
            ? { lawmatics_appointment_sync_enabled: state.lawmaticsEnabled,
                statular_sync_enabled: state.statularEnabled }
            : table === 'appointments'
              ? { id: 'appointments-id-1', source: 'public', updated_at: '2026-08-03T12:00:00Z',
                ...state.inserts.find(row => row.table === 'appointments')?.values,
                ...Object.assign({}, ...state.updates.filter(row => row.table === 'appointments').map(row => row.values)) }
              : state.matterLookup,
            error: table === 'appointments' && state.statularAppointmentReadError
              ? { message: 'PRIVATE-DB-SNAPSHOT' } : null })),
        }
        return chain
      }),
    }
  }
  return {
    ADMIN_EMAIL: 'scott@aubreylegal.com',
    getAdminClient: vi.fn(() => ({ from: vi.fn((table: string) => builderFor(table)),
      rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
        if (name !== 'enqueue_workflow_job') throw new Error('Unexpected RPC')
        if (state.enqueueError) throw new Error('PRIVATE-TOKEN-PROVIDER-BODY')
        state.jobs.push(args)
        return { data: { id: 'job-1' }, error: null }
      }),
    })),
  }
})

vi.mock('@/lib/calcom/link', () => ({
  findLeadByEmail: vi.fn(async () => state.lead),
  findMatterIdByEmail: vi.fn(async () => state.matterId),
}))

vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn(async (args: { category: string; to: string; subject: string; html?: string }) => {
    state.emails.push({ category: args.category, to: args.to, subject: args.subject, html: args.html })
    return { ok: true, status: 'sent', providerMessageId: null, logId: null }
  }),
}))

vi.mock('@/lib/firmSettings', () => ({
  loadFirmSettings: vi.fn(async () => ({
    street: '1 Main St',
    city: 'Needham',
    state: 'MA',
    zip: '02492',
  })),
}))

vi.mock('@/lib/appointments/calendarBusy', () => {
  class AvailabilityUnavailableError extends Error {}
  return {
    AvailabilityUnavailableError,
    fetchAllBusy: vi.fn(async () => state.busy),
  }
})

// Google is the firm's calendar. The googleEvents mock below is reached
// *through* the real calendarSync dispatch rather than in place of it, so these
// tests still prove a booking routes to the calendar the app actually writes to.
vi.mock('@/lib/appointments/googleEvents', () => ({
  createCalendarEvent: vi.fn(async (input: Record<string, unknown>) => {
    state.createdEvents.push(input)
    return { eventId: 'google-event-1', onlineMeetingUrl: null }
  }),
  cancelCalendarEvent: vi.fn(async (eventId: string) => {
    state.cancelledEvents.push(eventId)
  }),
  rescheduleCalendarEvent: vi.fn(async () => {}),
  getCalendarEventAttendees: vi.fn(async () => []),
}))

vi.mock('@/lib/microsoftTeams', () => ({
  createTeamsMeeting: vi.fn(async (input: Record<string, unknown>) => {
    if (state.teamsError) throw state.teamsError
    state.teamsCreated.push(input)
    return { id: 'teams-1', joinUrl: 'https://teams.microsoft.com/l/meetup-join/abc' }
  }),
  deleteTeamsMeeting: vi.fn(async (id: string) => { state.teamsDeleted.push(id) }),
  rescheduleTeamsMeeting: vi.fn(async (id: string) => { state.teamsRescheduled.push(id) }),
}))

vi.mock('@/lib/appointments/settings', () => ({
  getAppointmentTypeByKey: vi.fn(async () => TYPE),
  listAppointmentTypes: vi.fn(async () => [TYPE]),
  getSchedulingSettings: vi.fn(async () => ({
    timezone: 'America/New_York',
    weeklyHours: {
      sun: [],
      mon: [{ start: '09:00', end: '17:00' }],
      tue: [{ start: '09:00', end: '17:00' }],
      wed: [{ start: '09:00', end: '17:00' }],
      thu: [{ start: '09:00', end: '17:00' }],
      fri: [{ start: '09:00', end: '17:00' }],
      sat: [],
    },
    minNoticeHours: 0,
    horizonDays: 60,
    bufferMinutes: 0,
    reminderHoursBefore: 24,
    bookingPaused: state.paused,
    smsRemindersEnabled: false,
    autoIntakeInvite: true,
    dateOverrides: state.dateOverrides,
  })),
}))

vi.mock('@/lib/integrations/statular/config', () => ({
  getStatularConfig: vi.fn(() => {
    if (state.statularConfigError) throw new Error('PRIVATE-STATULAR-WEBHOOK-URL')
    return {
      clientWebhookUrl: 'https://statular.test/client-secret',
      matterWebhookUrl: 'https://statular.test/matter-secret',
      generation: 'generation-1',
    }
  }),
}))

vi.mock('@/lib/appointments/publicRouteGuard', () => ({ guardPublicSchedulingRoute: vi.fn(async () => null) }))
vi.mock('@/lib/supabaseServer', () => ({ getCachedClaims: vi.fn(async () => state.claims) }))
vi.mock('@/lib/apiAuth', () => ({ requireAdmin: vi.fn(async () => ({ err: null, userId: 'staff-1' })) }))

vi.mock('@/lib/appointments/automation', () => ({
  runPostBookingAutomation: vi.fn(async (input: Record<string, unknown>) => {
    state.automationCalls.push(input)
  }),
}))

vi.mock('@/lib/bookings/pmpsAnchor', () => ({
  recordPmpsAnchor: vi.fn(async (_admin: unknown, input: Record<string, unknown>) => {
    state.pmpsAnchors.push(input)
  }),
}))

// Same treatment as the pmps anchor: what belongs here is which bookings reach
// the anchor and with what, not how it writes. The write itself — write-once vs
// reschedule, the read-back, the task dating — is pinned in
// tests/discovery-booking-anchor.test.ts against a mock that models it.
vi.mock('@/lib/bookings/discoveryAnchor', () => ({
  recordDiscoveryAnchor: vi.fn(async (_admin: unknown, input: Record<string, unknown>) => {
    state.discoveryAnchors.push(input)
  }),
}))

import {
  bookAppointment,
  BookingPausedError,
  cancelAppointment,
  rescheduleAppointment,
  SlotTakenError,
} from '@/lib/appointments/book'
import { POST as publicBook } from '@/app/api/scheduling/book/route'
import { POST as adminBook } from '@/app/api/admin/scheduling/appointments/route'

// ── fixtures ────────────────────────────────────────────────────────────────

const TYPE: AppointmentType = {
  id: 'type-1',
  key: 'discovery_call',
  slug: 'discovery-call',
  label: 'Discovery Call',
  description: '',
  durationMinutes: 30,
  locationType: 'phone',
  locationTypes: ['phone', 'teams'],
  active: true,
  public: true,
  sort: 1,
  customWeeklyHours: null,
  bookingQuestions: [],
}

// Monday 2026-08-10 10:00 ET = 14:00 UTC — inside mon 09:00–17:00.
const SLOT_ISO = '2026-08-10T14:00:00.000Z'

function bookingInput() {
  return {
    type: TYPE,
    startIso: SLOT_ISO,
    attendeeFirstName: 'Pat',
    attendeeLastName: 'Client',
    attendeeEmail: 'pat@example.com',
    attendeePhone: '555-0100',
    notes: null,
    source: 'public' as const,
    bookedByUserId: null,
  }
}

beforeEach(() => {
  state.reset()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-03T12:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('booking name API contracts', () => {
  it('keeps generated component columns nullable and optional for historical inserts', () => {
    type Names = 'attendee_first_name' | 'attendee_last_name' | 'second_attendee_first_name' | 'second_attendee_last_name'
    type Table = Database['public']['Tables']['appointments']
    expectTypeOf<Pick<Table['Row'], Names>>().toEqualTypeOf<Record<Names, string | null>>()
    expectTypeOf<Pick<Table['Insert'], Names>>().toEqualTypeOf<Partial<Record<Names, string | null>>>()
    expectTypeOf<Pick<Table['Update'], Names>>().toEqualTypeOf<Partial<Record<Names, string | null>>>()
  })
  function request(body: Record<string, unknown>) {
    return new NextRequest('http://localhost/api/scheduling/book', { method: 'POST', body: JSON.stringify(body) })
  }
  const base = { typeKey: 'discovery_call', startTime: SLOT_ISO, firstName: 'Mary Jane', lastName: 'van Buren', email: 'pat@example.com' }

  it.each(['firstName', 'lastName'])('requires separate primary %s', async field => {
    const response = await publicBook(request({ ...base, name: 'Historical Name', [field]: '' }))
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain(field)
    expect(state.inserts).toHaveLength(0)
  })

  it.each([
    { firstName: 'a'.repeat(81) }, { lastName: 123 },
    { secondAttendeeFirstName: 'Sam' }, { secondAttendeeLastName: 'Smith' },
    { secondAttendeeFirstName: 123, secondAttendeeLastName: 'Smith' },
    { secondAttendeeFirstName: 'a'.repeat(81), secondAttendeeLastName: 'Smith' },
    { secondAttendeeEmail: 'sam@example.com' },
  ])('rejects invalid public components: %j', async invalid => {
    expect((await publicBook(request({ ...base, ...invalid }))).status).toBe(400)
    expect(state.inserts).toHaveLength(0)
  })

  it('normalizes components and preserves session email and portal attribution', async () => {
    state.claims = { id: 'client-1', email: 'session@example.com' }
    const response = await publicBook(request({ ...base, firstName: ' Mary  Jane ', lastName: ' van  Buren ',
      secondAttendeeFirstName: ' Jo Ann ', secondAttendeeLastName: ' de la Cruz ', secondAttendeeEmail: 'JO@example.com' }))
    expect(response.status).toBe(200)
    expect(state.inserts.find(row => row.table === 'appointments')?.values).toMatchObject({
      attendee_first_name: 'Mary Jane', attendee_last_name: 'van Buren', attendee_name: 'Mary Jane van Buren',
      attendee_email: 'session@example.com', booked_by_user_id: 'client-1', source: 'portal',
      second_attendee_first_name: 'Jo Ann', second_attendee_last_name: 'de la Cruz', second_attendee_email: 'jo@example.com',
    })
  })

  it('accepts valid 80-character components at the boundary', async () => {
    expect((await publicBook(request({ ...base, firstName: 'a'.repeat(80), lastName: 'b'.repeat(80) }))).status).toBe(200)
  })

  it('requires staff component names even when a display name was supplied', async () => {
    const response = await adminBook(request({ typeId: TYPE.id, startIso: SLOT_ISO, attendeeName: 'Pat Client', attendeeEmail: 'pat@example.com' }))
    expect(response.status).toBe(400)
    expect(state.inserts).toHaveLength(0)
  })

  it('books staff-supplied components with staff attribution', async () => {
    const response = await adminBook(request({ typeId: TYPE.id, startIso: SLOT_ISO, attendeeFirstName: ' Mary Jane ', attendeeLastName: ' van Buren ',
      attendeeEmail: 'pat@example.com', secondAttendeeFirstName: 'Sam', secondAttendeeLastName: 'Smith' }))
    expect(response.status).toBe(200)
    expect(state.inserts.find(row => row.table === 'appointments')?.values).toMatchObject({
      attendee_first_name: 'Mary Jane', attendee_last_name: 'van Buren', source: 'admin', booked_by_user_id: 'staff-1',
      second_attendee_first_name: 'Sam', second_attendee_last_name: 'Smith',
    })
  })

  it.each([
    { attendeeFirstName: 'a'.repeat(81) }, { attendeeLastName: '  ' },
    { secondAttendeeFirstName: 'Sam' }, { secondAttendeeLastName: 'Smith' },
    { secondAttendeeFirstName: 'Sam', secondAttendeeLastName: 'a'.repeat(81) },
    { secondAttendeeEmail: 'sam@example.com' },
  ])('rejects invalid staff components: %j', async invalid => {
    const response = await adminBook(request({ typeId: TYPE.id, startIso: SLOT_ISO,
      attendeeFirstName: 'Pat', attendeeLastName: 'Client', attendeeEmail: 'pat@example.com', ...invalid }))
    expect(response.status).toBe(400)
    expect(state.inserts).toHaveLength(0)
  })
})

describe('bookAppointment', () => {
  it('persists supplied multi-word components without guessing a split', async () => {
    await bookAppointment({ ...bookingInput(), attendeeFirstName: '  Mary   Jane ', attendeeLastName: ' van  Buren ',
      secondAttendeeFirstName: ' Jo  Ann ', secondAttendeeLastName: ' de  la Cruz ' })
    expect(state.inserts.find(row => row.table === 'appointments')?.values).toMatchObject({
      attendee_first_name: 'Mary Jane', attendee_last_name: 'van Buren', attendee_name: 'Mary Jane van Buren',
      second_attendee_first_name: 'Jo Ann', second_attendee_last_name: 'de la Cruz', second_attendee_name: 'Jo Ann de la Cruz',
    })
    expect(state.inserts.find(row => row.table === 'client_intake')?.values).toMatchObject({
      first_name: 'Mary Jane', last_name: 'van Buren', full_name: 'Mary Jane van Buren',
    })
    expect(state.createdEvents[0]).toMatchObject({ attendeeName: 'Mary Jane van Buren', secondAttendeeName: 'Jo Ann de la Cruz' })
  })

  it.each([
    { attendeeFirstName: '' }, { attendeeLastName: '  ' }, { attendeeFirstName: 'a'.repeat(81) },
    { secondAttendeeFirstName: 'Sam' }, { secondAttendeeLastName: 'Spouse' },
    { secondAttendeeEmail: 'sam@example.com' },
  ])('rejects invalid component names before writing: %j', async invalid => {
    await expect(bookAppointment({ ...bookingInput(), ...invalid })).rejects.toThrow(/name/i)
    expect(state.inserts).toHaveLength(0)
  })
  it.each([false, true])('enqueues the committed linked booking only when Lawmatics is enabled (%s)', async enabled => {
    state.lawmaticsEnabled = enabled
    state.lead = { id: 'lead-9', lead_status: 'lead' }
    const result = await bookAppointment(bookingInput())
    expect(state.jobs).toHaveLength(enabled ? 1 : 0)
    if (enabled) {
      expect(state.jobs[0]).toMatchObject({ p_job_type: 'lawmatics_sync_appointment',
        p_payload: { appointmentId: result.appointmentId, sourceVersion: expect.any(String) } })
      expect(Object.keys(state.jobs[0].p_payload as object).sort()).toEqual(['appointmentId', 'sourceVersion'])
    }
  })

  it('keeps the booking successful and logs no provider detail when enqueue fails', async () => {
    state.lawmaticsEnabled = true
    state.enqueueError = true
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(bookAppointment(bookingInput())).resolves.toMatchObject({ appointmentId: 'appointments-id-1' })
      expect(log).toHaveBeenCalledWith('[appointments] lawmatics enqueue failed', 'appointments-id-1', 'enqueue_failed')
      expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE-TOKEN')
    } finally { log.mockRestore() }
  })

  it('does not create a Statular client at booking time; the fit decision does', async () => {
    state.statularEnabled = true
    state.lead = { id: 'lead-9', lead_status: 'lead' }

    const result = await bookAppointment(bookingInput())

    expect(state.updates).toContainEqual(expect.objectContaining({
      table: 'appointments', values: expect.objectContaining({ linked_lead_id: 'lead-9' }),
    }))
    expect(state.jobs).not.toContainEqual(expect.objectContaining({ p_job_type: 'statular_create_client' }))
    expect(result.appointmentId).toBe('appointments-id-1')
  })

  it.each(['portal', 'public', 'admin'] as const)('uses staff-only job attribution for %s booking', async source => {
    state.lawmaticsEnabled = true
    await bookAppointment({ ...bookingInput(), source, bookedByUserId: 'booking-user' })
    // enqueue_workflow_job validates non-null actor IDs as billing staff. Portal
    // clients are already attributed on appointments and must not fail that gate.
    expect(state.jobs[0].p_actor_id).toBe(source === 'admin' ? 'booking-user' : null)
  })

  it('books a valid slot: inserts row, creates the calendar event, sends emails', async () => {
    const result = await bookAppointment(bookingInput())

    expect(result.startIso).toBe(SLOT_ISO)
    expect(result.endIso).toBe('2026-08-10T14:30:00.000Z')
    expect(result.manageToken).toBeTruthy()

    const apptInsert = state.inserts.find(i => i.table === 'appointments')
    expect(apptInsert).toBeTruthy()
    expect(apptInsert?.values.start_time).toBe(SLOT_ISO)
    expect(apptInsert?.values.manage_token_hash).toMatch(/^[0-9a-f]{64}$/)

    // Calendar event created and saved back
    expect(state.createdEvents).toHaveLength(1)
    expect(
      state.updates.some(u => u.table === 'appointments' && u.values.google_event_id === 'google-event-1'),
    ).toBe(true)

    // Confirmation to client + internal alert
    const categories = state.emails.map(e => e.category).sort()
    expect(categories).toEqual(['appointment_booked_alert', 'appointment_confirmation'])
  })

  it('creates a lead for a public discovery call with no existing match', async () => {
    await bookAppointment(bookingInput())
    const leadInsert = state.inserts.find(i => i.table === 'client_intake')
    expect(leadInsert).toBeTruthy()
    expect(leadInsert?.values.lead_source).toBe('scheduler')
    expect(state.inserts.some(i => i.table === 'lead_activity')).toBe(true)
  })

  it('links an existing lead instead of creating one', async () => {
    state.lead = { id: 'lead-9', lead_status: 'lead' }
    await bookAppointment(bookingInput())
    expect(state.inserts.some(i => i.table === 'client_intake')).toBe(false)
    expect(
      state.updates.some(u => u.table === 'appointments' && u.values.linked_lead_id === 'lead-9'),
    ).toBe(true)
  })

  it('rejects a slot that conflicts with busy time', async () => {
    state.busy = [
      { start: Date.parse('2026-08-10T14:00:00Z'), end: Date.parse('2026-08-10T15:00:00Z') },
    ]
    await expect(bookAppointment(bookingInput())).rejects.toThrow(SlotTakenError)
    expect(state.inserts.find(i => i.table === 'appointments')).toBeUndefined()
  })

  it('rejects a slot outside weekly hours', async () => {
    await expect(
      bookAppointment({ ...bookingInput(), startIso: '2026-08-09T14:00:00.000Z' }), // Sunday
    ).rejects.toThrow(SlotTakenError)
  })

  it("rejects a slot outside the type's custom hours even when general hours allow it", async () => {
    const tuesdayOnly: AppointmentType = {
      ...TYPE,
      customWeeklyHours: {
        sun: [], mon: [], tue: [{ start: '09:00', end: '17:00' }], wed: [], thu: [], fri: [], sat: [],
      },
    }
    // Monday 10:00 ET — inside general hours, outside the type's Tuesday-only hours.
    await expect(
      bookAppointment({ ...bookingInput(), type: tuesdayOnly }),
    ).rejects.toThrow(SlotTakenError)
    // Tuesday 10:00 ET books fine.
    await bookAppointment({
      ...bookingInput(),
      type: tuesdayOnly,
      startIso: '2026-08-11T14:00:00.000Z',
    })
    expect(state.inserts.find(i => i.table === 'appointments')).toBeDefined()
  })

  it('admin bookings bypass weekly hours but still reject hard conflicts', async () => {
    // Sunday 10:00 ET — outside weekly hours; a client booking would fail.
    const sunday = '2026-08-09T14:00:00.000Z'
    await bookAppointment({ ...bookingInput(), source: 'admin', startIso: sunday })
    expect(state.inserts.find(i => i.table === 'appointments')).toBeDefined()

    // Same slot with a calendar conflict is still rejected.
    state.reset()
    state.busy = [
      { start: Date.parse('2026-08-09T14:00:00Z'), end: Date.parse('2026-08-09T15:00:00Z') },
    ]
    await expect(
      bookAppointment({ ...bookingInput(), source: 'admin', startIso: sunday }),
    ).rejects.toThrow(SlotTakenError)
  })

  it('stores the chosen meeting format and uses it for the calendar event', async () => {
    await bookAppointment({ ...bookingInput(), locationType: 'teams' })
    const insert = state.inserts.find(i => i.table === 'appointments')
    expect(insert?.values.location_type).toBe('teams')
    // Calendar event created as a video meeting, not the type's phone default.
    const eventType = state.createdEvents[0]?.type as { locationType?: string } | undefined
    expect(eventType?.locationType).toBe('teams')
  })

  it('creates a Teams meeting instead of Meet when staff ask for Teams', async () => {
    await bookAppointment({ ...bookingInput(), source: 'admin', locationType: 'teams', videoProvider: 'microsoft_teams' })

    expect(state.teamsCreated).toEqual([expect.objectContaining({
      startIso: SLOT_ISO,
      endIso: '2026-08-10T14:30:00.000Z',
    })])
    expect(state.createdEvents[0]?.teamsJoinUrl).toBe('https://teams.microsoft.com/l/meetup-join/abc')
    expect(state.updates).toContainEqual(expect.objectContaining({
      table: 'appointments',
      values: expect.objectContaining({
        online_meeting_provider: 'microsoft_teams',
        teams_meeting_id: 'teams-1',
      }),
    }))
  })

  it('ignores a Teams request for a phone appointment', async () => {
    await bookAppointment({ ...bookingInput(), source: 'admin', locationType: 'phone', videoProvider: 'microsoft_teams' })
    expect(state.teamsCreated).toHaveLength(0)
    expect(state.createdEvents[0]?.teamsJoinUrl).toBeNull()
  })

  it('falls back to Meet and reports why when Teams cannot be created', async () => {
    state.teamsError = new Error('Microsoft Teams is not connected')

    const result = await bookAppointment({ ...bookingInput(), source: 'admin', locationType: 'teams', videoProvider: 'microsoft_teams' })

    expect(result.teamsMeetingError).toMatch(/not connected/)
    expect(state.createdEvents[0]?.teamsJoinUrl).toBeNull()
    expect(state.emails.some(e => e.category === 'appointment_confirmation')).toBe(true)
  })

  it('falls back to the default format when the choice is not allowed', async () => {
    await bookAppointment({ ...bookingInput(), locationType: 'in_person' })
    const insert = state.inserts.find(i => i.table === 'appointments')
    expect(insert?.values.location_type).toBe('phone')
  })

  it('admin bookings send the client confirmation but no internal alert', async () => {
    await bookAppointment({ ...bookingInput(), source: 'admin' })
    const categories = state.emails.map(e => e.category)
    expect(categories).toContain('appointment_confirmation')
    expect(categories).not.toContain('appointment_booked_alert')
  })

  it('rejects client bookings while paused; admin bookings still work', async () => {
    state.paused = true
    await expect(bookAppointment(bookingInput())).rejects.toThrow(BookingPausedError)
    await bookAppointment({ ...bookingInput(), source: 'admin' })
    expect(state.inserts.find(i => i.table === 'appointments')).toBeDefined()
  })

  it('a date override closing the day removes its slots for client bookings', async () => {
    state.dateOverrides = { '2026-08-10': [] } // the Monday of SLOT_ISO, closed
    await expect(bookAppointment(bookingInput())).rejects.toThrow(SlotTakenError)
  })

  it('invites the spouse on the event and stores their details', async () => {
    await bookAppointment({
      ...bookingInput(),
      secondAttendeeFirstName: 'Sam',
      secondAttendeeLastName: 'Spouse',
      secondAttendeeEmail: 'Sam@Example.com',
    })
    const insert = state.inserts.find(i => i.table === 'appointments')
    expect(insert?.values.second_attendee_email).toBe('sam@example.com')
    const event = state.createdEvents[0] as { secondAttendeeEmail?: string } | undefined
    expect(event?.secondAttendeeEmail).toBe('Sam@Example.com')
  })

  it('runs post-booking automation with the lead and settings toggle', async () => {
    state.lead = { id: 'lead-9', lead_status: 'lead' }
    await bookAppointment(bookingInput())
    expect(state.automationCalls).toHaveLength(1)
    expect(state.automationCalls[0]).toMatchObject({
      leadId: 'lead-9',
      autoIntakeInvite: true,
    })
  })

  it('maps the exclusion-constraint race to SlotTakenError', async () => {
    state.insertError = { code: '23P01', message: 'conflicting key value violates exclusion constraint "appointments_no_overlap"' }
    await expect(bookAppointment(bookingInput())).rejects.toThrow(SlotTakenError)
  })

  it('records the pmps anchor for a hired matter and writes no design meeting date', async () => {
    state.matterId = 'matter-7'
    await bookAppointment({
      ...bookingInput(),
      type: { ...TYPE, key: 'pmps', slug: 'pmps', label: 'PMPS' },
    })
    expect(state.pmpsAnchors).toEqual([
      { leadId: null, matterId: 'matter-7', startIso: SLOT_ISO },
    ])
    // v3 moved the planning session out of the design phase; stamping it as the
    // design meeting date put a pre-engagement sales call on the matter's
    // post-engagement timeline.
    const upsert = state.inserts.find(i => i.table === 'matter_details:upsert')
    expect(upsert?.values.design_meeting_date).toBeUndefined()
    expect(state.inserts.some(i => i.table === 'matter_notes')).toBe(true)
  })

  it('records the pmps anchor for a lead with no hired matter', async () => {
    // The case the old code could not reach: findMatterIdByEmail is hired-only,
    // and under v3 the planning session happens before anyone is hired.
    state.lead = { id: 'lead-9', lead_status: 'lead' }
    state.matterId = null
    await bookAppointment({
      ...bookingInput(),
      type: { ...TYPE, key: 'pmps', slug: 'pmps', label: 'PMPS' },
    })
    expect(state.pmpsAnchors).toEqual([
      { leadId: 'lead-9', matterId: null, startIso: SLOT_ISO },
    ])
  })

  it('leaves the pmps anchor alone for other appointment types', async () => {
    state.matterId = 'matter-7'
    await bookAppointment(bookingInput())
    expect(state.pmpsAnchors).toHaveLength(0)
  })

  it('still books when the calendar event creation fails', async () => {
    const { createCalendarEvent } = await import('@/lib/appointments/googleEvents')
    vi.mocked(createCalendarEvent).mockRejectedValueOnce(new Error('Google Calendar is down'))

    const result = await bookAppointment(bookingInput())
    expect(result.appointmentId).toBeTruthy()
    // No google_event_id update happened
    expect(
      state.updates.some(u => u.table === 'appointments' && 'google_event_id' in u.values),
    ).toBe(false)
    // Confirmation still sent
    expect(state.emails.some(e => e.category === 'appointment_confirmation')).toBe(true)
  })

  it('stamps the discovery call anchor on the lead’s matter', async () => {
    // findMatterIdByEmail is hired-only, so state.matterId stays null: the stamp
    // has to find the matter through the lead, not through that helper.
    state.lead = { id: 'lead-9', lead_status: 'lead' }

    await bookAppointment(bookingInput())

    expect(state.discoveryAnchors).toEqual([
      { leadId: 'lead-9', matterId: null, startIso: SLOT_ISO, overwrite: false },
    ])
  })

  it('books write-once, so it cannot clobber a date an attorney corrected', async () => {
    state.lead = { id: 'lead-9', lead_status: 'lead' }
    await bookAppointment(bookingInput())
    expect(state.discoveryAnchors[0]?.overwrite).toBe(false)
  })

  it('does not stamp the anchor for a non-discovery appointment type', async () => {
    state.lead = { id: 'lead-9', lead_status: 'lead' }

    await bookAppointment({
      ...bookingInput(),
      type: { ...TYPE, key: 'signing_appointment', slug: 'signing', label: 'Signing' },
    })

    expect(state.discoveryAnchors).toHaveLength(0)
  })
})

describe('cancelAppointment', () => {
  const ROW: AppointmentRow = {
    id: 'appt-1',
    appointment_type_id: 'type-1',
    start_time: SLOT_ISO,
    end_time: '2026-08-10T14:30:00.000Z',
    status: 'scheduled',
    location_type: 'teams',
    attendee_name: 'Pat Client',
    attendee_email: 'pat@example.com',
    attendee_phone: null,
    second_attendee_name: null,
    second_attendee_email: null,
    notes: null,
    linked_lead_id: 'lead-9',
    linked_matter_id: null,
    booked_by_user_id: null,
    google_event_id: 'google-event-1',
    manage_token_hash: 'hash',
    manage_token_expires_at: '2026-10-01T00:00:00Z',
    reminder_sent_at: null,
    online_meeting_url: 'https://teams.example.test/meeting',
    source: 'public',
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
  }

  it('deletes the Teams meeting of a cancelled appointment', async () => {
    await cancelAppointment({ appointment: { ...ROW, teams_meeting_id: 'teams-1' }, type: TYPE })
    expect(state.teamsDeleted).toEqual(['teams-1'])
  })

  it('cancels: updates status, deletes the calendar event, notes the lead', async () => {
    await cancelAppointment({ appointment: ROW, type: TYPE })
    expect(
      state.updates.some(u => u.table === 'appointments' && u.values.status === 'cancelled'),
    ).toBe(true)
    expect(state.cancelledEvents).toEqual(['google-event-1'])
    expect(state.inserts.some(i => i.table === 'lead_activity')).toBe(true)
    expect(state.emails.some(e => e.category === 'appointment_booked_alert')).toBe(true)
  })

  it.each([false, true])('enqueues cancellation only when enabled (%s)', async enabled => {
    state.lawmaticsEnabled = enabled
    await cancelAppointment({ appointment: ROW, type: TYPE })
    expect(state.jobs).toHaveLength(enabled ? 1 : 0)
    if (enabled) expect(state.jobs[0].p_payload).toMatchObject({ appointmentId: ROW.id })
  })

  it('does not enqueue Statular client creation for cancellation', async () => {
    state.statularEnabled = true
    await cancelAppointment({ appointment: ROW, type: TYPE })
    expect(state.jobs).toHaveLength(0)
  })

  it('keeps cancellation successful if enqueue fails', async () => {
    state.lawmaticsEnabled = true
    state.enqueueError = true
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(cancelAppointment({ appointment: ROW, type: TYPE })).resolves.toBeUndefined()
      expect(log).toHaveBeenCalledWith('[appointments] lawmatics enqueue failed', ROW.id, 'enqueue_failed')
    } finally { log.mockRestore() }
  })

  // ── a cancel does not roll back the key dates ─────────────────────────────
  //
  // Decided, not overlooked. `pmps_at` is the firm's commitment date, keyed off
  // the column precisely so the native scheduler, the Cal.com/Calendly webhook
  // and the attorney's key-dates panel all mean the same thing by it. Reverting
  // it on one appointment's cancellation would re-couple it to that
  // appointment's lifecycle, and the rollback could only ever be partial:
  // `stamp_lead_pmps_stage` is forward-only, so the lead stays at
  // `intake_completed` either way. The cancellation is recorded as activity
  // instead, and the common next step — a rebook — re-stamps the date.

  const PMPS_TYPE: AppointmentType = { ...TYPE, key: 'pmps', slug: 'pmps', label: 'PMPS' }
  const HIRED = { ...ROW, linked_matter_id: 'matter-7' }

  it('leaves pmps_at standing when the planning session is cancelled', async () => {
    await cancelAppointment({ appointment: HIRED, type: PMPS_TYPE })
    expect(state.pmpsAnchors).toHaveLength(0)
    expect(state.updates.some(u => u.table === 'matters')).toBe(false)
  })

  it('leaves the target signing date standing when a signing is cancelled', async () => {
    // Same call, and the harder case: an attorney types this target by hand in
    // the Dates panel, so a cancelled slot must not clobber it.
    await cancelAppointment({
      appointment: HIRED,
      type: { ...TYPE, key: 'signing_appointment', slug: 'signing', label: 'Signing' },
    })
    expect(
      state.inserts.some(
        i => i.table === 'matter_details:upsert' && 'scheduled_signing_date' in i.values,
      ),
    ).toBe(false)
  })

  it('records the cancellation, so a standing date is not silently stale', async () => {
    // What makes keeping the date defensible: the reason it looks wrong is on
    // the timeline and in the matter's notes.
    await cancelAppointment({ appointment: HIRED, type: PMPS_TYPE })
    expect(state.inserts.some(i => i.table === 'lead_activity')).toBe(true)
    expect(state.inserts.some(i => i.table === 'matter_notes')).toBe(true)
  })
})

describe('rescheduleAppointment', () => {
  // The other half of the cancel decision: nothing is stranded, because moving
  // a session re-stamps the anchor and re-dates the plan off the new day.
  // Reschedule does not route through cancelAppointment — it updates the row in
  // place — so keeping the date on cancel costs this path nothing.
  const ROW: AppointmentRow = {
    id: 'appt-1',
    appointment_type_id: 'type-1',
    start_time: SLOT_ISO,
    end_time: '2026-08-10T14:30:00.000Z',
    status: 'scheduled',
    location_type: 'teams',
    attendee_name: 'Pat Client',
    attendee_email: 'pat@example.com',
    attendee_phone: null,
    second_attendee_name: null,
    second_attendee_email: null,
    notes: null,
    linked_lead_id: 'lead-9',
    linked_matter_id: 'matter-7',
    booked_by_user_id: null,
    google_event_id: 'google-event-1',
    manage_token_hash: 'hash',
    manage_token_expires_at: '2026-10-01T00:00:00Z',
    reminder_sent_at: null,
    online_meeting_url: 'https://teams.example.test/meeting',
    source: 'public',
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
  }

  // Tue 2026-08-11 10:00 ET = 14:00 UTC — inside tue 09:00–17:00.
  const MOVED_ISO = '2026-08-11T14:00:00.000Z'

  it('moves the Teams meeting along with the appointment', async () => {
    await rescheduleAppointment({
      appointment: { ...ROW, teams_meeting_id: 'teams-1', online_meeting_provider: 'microsoft_teams' },
      type: TYPE,
      newStartIso: MOVED_ISO,
    })
    expect(state.teamsRescheduled).toEqual(['teams-1'])
  })

  it.each([false, true])('enqueues rescheduling only when enabled (%s)', async enabled => {
    state.lawmaticsEnabled = enabled
    await rescheduleAppointment({ appointment: ROW, type: TYPE, newStartIso: MOVED_ISO })
    expect(state.jobs).toHaveLength(enabled ? 1 : 0)
    if (enabled) expect(state.jobs[0].p_payload).toMatchObject({ appointmentId: ROW.id })
  })

  it('does not enqueue Statular client creation for rescheduling', async () => {
    state.statularEnabled = true
    await rescheduleAppointment({ appointment: ROW, type: TYPE, newStartIso: MOVED_ISO })
    expect(state.jobs).toHaveLength(0)
  })

  it('keeps rescheduling successful if enqueue fails', async () => {
    state.lawmaticsEnabled = true
    state.enqueueError = true
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(rescheduleAppointment({ appointment: ROW, type: TYPE, newStartIso: MOVED_ISO }))
        .resolves.toEqual({ startIso: MOVED_ISO, endIso: '2026-08-11T14:30:00.000Z' })
      expect(log).toHaveBeenCalledWith('[appointments] lawmatics enqueue failed', ROW.id, 'enqueue_failed')
    } finally { log.mockRestore() }
  })

  it('re-stamps the pmps anchor at the new day', async () => {
    await rescheduleAppointment({
      appointment: ROW,
      type: { ...TYPE, key: 'pmps', slug: 'pmps', label: 'PMPS' },
      newStartIso: MOVED_ISO,
    })
    expect(state.pmpsAnchors).toEqual([
      { leadId: 'lead-9', matterId: 'matter-7', startIso: MOVED_ISO },
    ])
  })
})

describe('booking questions', () => {
  const questions: AppointmentType['bookingQuestions'] = [
    { id: 'reason', label: 'What prompted you to reach out?', kind: 'long_text', required: true, options: [] },
    { id: 'kids', label: 'Do you have minor children?', kind: 'yes_no', required: false, options: [] },
    { id: 'heard', label: 'How did you hear about us?', kind: 'choice', required: false, options: ['Referral', 'Google'] },
  ]
  function request(body: Record<string, unknown>) {
    return new NextRequest('http://localhost/api/scheduling/book', { method: 'POST', body: JSON.stringify(body) })
  }
  const base = { typeKey: 'discovery_call', startTime: SLOT_ISO, firstName: 'Mary', lastName: 'Jones', email: 'pat@example.com' }

  beforeEach(() => { TYPE.bookingQuestions = questions })
  afterEach(() => { TYPE.bookingQuestions = [] })

  it('rejects a booking that skips a required question', async () => {
    const response = await publicBook(request({ ...base, answers: { kids: 'Yes' } }))
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('Please answer: What prompted you to reach out?')
    expect(state.inserts).toHaveLength(0)
  })

  it('rejects an answer outside a choice question\'s options', async () => {
    const response = await publicBook(request({ ...base, answers: { reason: 'Planning', heard: 'Billboard' } }))
    expect(response.status).toBe(400)
    expect(state.inserts).toHaveLength(0)
  })

  it('stores answers with their labels and shows them, escaped, to staff', async () => {
    const response = await publicBook(request({
      ...base,
      answers: { reason: 'New baby <b>& a house</b>', kids: 'Yes', heard: '', bogus: 'ignored' },
    }))
    expect(response.status).toBe(200)
    expect(state.inserts.find(row => row.table === 'appointments')?.values.booking_answers).toEqual([
      { questionId: 'reason', label: 'What prompted you to reach out?', answer: 'New baby <b>& a house</b>' },
      { questionId: 'kids', label: 'Do you have minor children?', answer: 'Yes' },
    ])
    expect(state.createdEvents[0]?.bookingAnswers).toHaveLength(2)
    const alert = state.emails.find(e => e.category === 'appointment_booked_alert')
    expect(alert?.html).toContain('New baby &lt;b&gt;&amp; a house&lt;/b&gt;')
    expect(alert?.html).not.toContain('<b>&')
  })

  it('keeps the answers and notes on the lead timeline', async () => {
    state.lead = { id: 'lead-9', lead_status: 'lead' }
    const response = await publicBook(request({ ...base, notes: 'Call after 3', answers: { reason: 'New baby', kids: 'No' } }))
    expect(response.status).toBe(200)
    const activity = state.inserts.find(row => row.table === 'lead_activity' && row.values.event_type === 'consult_scheduled')
    expect(activity?.values.detail).toContain('What prompted you to reach out?\nNew baby')
    expect(activity?.values.detail).toContain('Do you have minor children?\nNo')
    expect(activity?.values.detail).toContain('Notes\nCall after 3')
  })

  it('lets staff book without the required answers but stores what they enter', async () => {
    const staff = { typeId: TYPE.id, startIso: SLOT_ISO, attendeeFirstName: 'Mary', attendeeLastName: 'Jones', attendeeEmail: 'mary@example.com' }
    const response = await adminBook(request({ ...staff, answers: { heard: 'Referral' } }))
    expect(response.status).toBe(200)
    expect(state.inserts.find(row => row.table === 'appointments')?.values.booking_answers).toEqual([
      { questionId: 'heard', label: 'How did you hear about us?', answer: 'Referral' },
    ])
  })

  it('still rejects a staff answer outside a choice question\'s options', async () => {
    const staff = { typeId: TYPE.id, startIso: SLOT_ISO, attendeeFirstName: 'Mary', attendeeLastName: 'Jones', attendeeEmail: 'mary@example.com' }
    const response = await adminBook(request({ ...staff, answers: { heard: 'Billboard' } }))
    expect(response.status).toBe(400)
    expect(state.inserts).toHaveLength(0)
  })

  it('links the firm alert to the booked day on the calendar', async () => {
    // 14:00 UTC on Aug 10 is the same day in America/New_York (10am).
    await publicBook(request({ ...base, answers: { reason: 'Planning' } }))
    const alert = state.emails.find(e => e.category === 'appointment_booked_alert')
    expect(alert?.html).toContain('/admin/calendar?date=2026-08-10')
    expect(alert?.html).toContain('View on the calendar')
  })

  it('omits booking_answers from the insert when there are none', async () => {
    TYPE.bookingQuestions = []
    await publicBook(request(base))
    expect(state.inserts.find(row => row.table === 'appointments')?.values).not.toHaveProperty('booking_answers')
  })
})
