import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppointmentRow, AppointmentType } from '@/lib/appointments/types'

vi.mock('server-only', () => ({}))

// ── shared mock state ────────────────────────────────────────────────────────

const state = vi.hoisted(() => ({
  inserts: [] as Array<{ table: string; values: Record<string, unknown> }>,
  updates: [] as Array<{ table: string; values: Record<string, unknown> }>,
  insertError: null as { code?: string; message?: string } | null,
  emails: [] as Array<{ category: string; to: string; subject: string }>,
  createdEvents: [] as Array<Record<string, unknown>>,
  cancelledEvents: [] as string[],
  busy: [] as Array<{ start: number; end: number }>,
  lead: null as { id: string; lead_status: string } | null,
  matterId: null as string | null,
  reset() {
    this.inserts = []
    this.updates = []
    this.insertError = null
    this.emails = []
    this.createdEvents = []
    this.cancelledEvents = []
    this.busy = []
    this.lead = null
    this.matterId = null
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
          then: (resolve: (v: unknown) => unknown) => resolve({ error: null }),
        }
        return chain
      }),
      upsert: vi.fn((values: Record<string, unknown>) => {
        state.inserts.push({ table: `${table}:upsert`, values })
        return { then: (resolve: (v: unknown) => unknown) => resolve({ error: null }) }
      }),
    }
  }
  return {
    ADMIN_EMAIL: 'scott@aubreylegal.com',
    getAdminClient: vi.fn(() => ({ from: vi.fn((table: string) => builderFor(table)) })),
  }
})

vi.mock('@/lib/calcom/link', () => ({
  findLeadByEmail: vi.fn(async () => state.lead),
  findMatterIdByEmail: vi.fn(async () => state.matterId),
}))

vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn(async (args: { category: string; to: string; subject: string }) => {
    state.emails.push({ category: args.category, to: args.to, subject: args.subject })
    return { ok: true, status: 'sent', resendId: null, logId: null }
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

vi.mock('@/lib/appointments/graphBusy', () => {
  class AvailabilityUnavailableError extends Error {}
  return {
    AvailabilityUnavailableError,
    fetchAllBusy: vi.fn(async () => state.busy),
  }
})

vi.mock('@/lib/appointments/graphEvents', () => ({
  createCalendarEvent: vi.fn(async (input: Record<string, unknown>) => {
    state.createdEvents.push(input)
    return { eventId: 'graph-event-1', onlineMeetingUrl: null }
  }),
  cancelCalendarEvent: vi.fn(async (eventId: string) => {
    state.cancelledEvents.push(eventId)
  }),
  rescheduleCalendarEvent: vi.fn(async () => {}),
}))

vi.mock('@/lib/appointments/settings', () => ({
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
  })),
}))

import { bookAppointment, cancelAppointment, SlotTakenError } from '@/lib/appointments/book'

// ── fixtures ────────────────────────────────────────────────────────────────

const TYPE: AppointmentType = {
  id: 'type-1',
  key: 'discovery_call',
  slug: 'discovery-call',
  label: 'Discovery Call',
  description: '',
  durationMinutes: 30,
  locationType: 'phone',
  active: true,
  public: true,
  sort: 1,
  customWeeklyHours: null,
}

// Monday 2026-08-10 10:00 ET = 14:00 UTC — inside mon 09:00–17:00.
const SLOT_ISO = '2026-08-10T14:00:00.000Z'

function bookingInput() {
  return {
    type: TYPE,
    startIso: SLOT_ISO,
    attendeeName: 'Pat Client',
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

describe('bookAppointment', () => {
  it('books a valid slot: inserts row, creates Graph event, sends emails', async () => {
    const result = await bookAppointment(bookingInput())

    expect(result.startIso).toBe(SLOT_ISO)
    expect(result.endIso).toBe('2026-08-10T14:30:00.000Z')
    expect(result.manageToken).toBeTruthy()

    const apptInsert = state.inserts.find(i => i.table === 'appointments')
    expect(apptInsert).toBeTruthy()
    expect(apptInsert?.values.start_time).toBe(SLOT_ISO)
    expect(apptInsert?.values.manage_token_hash).toMatch(/^[0-9a-f]{64}$/)

    // Graph event created and saved back
    expect(state.createdEvents).toHaveLength(1)
    expect(
      state.updates.some(u => u.table === 'appointments' && u.values.microsoft_event_id === 'graph-event-1'),
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

  it('maps the exclusion-constraint race to SlotTakenError', async () => {
    state.insertError = { code: '23P01', message: 'conflicting key value violates exclusion constraint "appointments_no_overlap"' }
    await expect(bookAppointment(bookingInput())).rejects.toThrow(SlotTakenError)
  })

  it('upserts matter_details design meeting date for pmps bookings with a matter', async () => {
    state.matterId = 'matter-7'
    await bookAppointment({
      ...bookingInput(),
      type: { ...TYPE, key: 'pmps', slug: 'design-meeting', label: 'PMPS' },
    })
    const upsert = state.inserts.find(i => i.table === 'matter_details:upsert')
    expect(upsert?.values.design_meeting_date).toBe('2026-08-10')
    expect(state.inserts.some(i => i.table === 'matter_notes')).toBe(true)
  })

  it('still books when the Graph event creation fails', async () => {
    const { createCalendarEvent } = await import('@/lib/appointments/graphEvents')
    vi.mocked(createCalendarEvent).mockRejectedValueOnce(new Error('graph down'))

    const result = await bookAppointment(bookingInput())
    expect(result.appointmentId).toBeTruthy()
    // No microsoft_event_id update happened
    expect(
      state.updates.some(u => u.table === 'appointments' && 'microsoft_event_id' in u.values),
    ).toBe(false)
    // Confirmation still sent
    expect(state.emails.some(e => e.category === 'appointment_confirmation')).toBe(true)
  })
})

describe('cancelAppointment', () => {
  const ROW: AppointmentRow = {
    id: 'appt-1',
    appointment_type_id: 'type-1',
    start_time: SLOT_ISO,
    end_time: '2026-08-10T14:30:00.000Z',
    status: 'scheduled',
    attendee_name: 'Pat Client',
    attendee_email: 'pat@example.com',
    attendee_phone: null,
    notes: null,
    linked_lead_id: 'lead-9',
    linked_matter_id: null,
    booked_by_user_id: null,
    microsoft_event_id: 'graph-event-1',
    manage_token_hash: 'hash',
    manage_token_expires_at: '2026-10-01T00:00:00Z',
    source: 'public',
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
  }

  it('cancels: updates status, deletes the Graph event, notes the lead', async () => {
    await cancelAppointment({ appointment: ROW, type: TYPE })
    expect(
      state.updates.some(u => u.table === 'appointments' && u.values.status === 'cancelled'),
    ).toBe(true)
    expect(state.cancelledEvents).toEqual(['graph-event-1'])
    expect(state.inserts.some(i => i.table === 'lead_activity')).toBe(true)
    expect(state.emails.some(e => e.category === 'appointment_booked_alert')).toBe(true)
  })
})
