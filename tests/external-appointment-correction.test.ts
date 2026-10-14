import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppointmentRow, AppointmentType } from '@/lib/appointments/types'

const anchors = vi.hoisted(() => ({
  discovery: vi.fn(async () => {}),
  pmps: vi.fn(async () => {}),
  cancelEvent: vi.fn(async () => {}),
  moveEvent: vi.fn(async () => {}),
  cancelTeams: vi.fn(async () => {}),
  moveTeams: vi.fn(async () => {}),
}))

const db = vi.hoisted(() => ({
  appointments: [] as Array<Record<string, unknown>>,
  external_bookings: [] as Array<Record<string, unknown>>,
  lead_activity: [] as Array<Record<string, unknown>>,
  matter_notes: [] as Array<Record<string, unknown>>,
  matter_details: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({
    from(table: keyof typeof db) {
      const filters: Array<[string, unknown]> = []
      let patch: Record<string, unknown> | null = null
      let inserted: Record<string, unknown> | null = null
      let op: 'select' | 'update' | 'insert' | 'upsert' = 'select'
      const run = () => {
        const rows = db[table]
        const matched = rows.filter(row => filters.every(([key, value]) => row[key] === value))
        if (op === 'update' && patch) {
          for (const row of matched) Object.assign(row, patch)
          return { data: matched.map(row => ({ ...row })), error: null }
        }
        if ((op === 'insert' || op === 'upsert') && inserted) {
          rows.push({ ...inserted })
          return { data: null, error: null }
        }
        return { data: matched.map(row => ({ ...row })), error: null }
      }
      const chain: Record<string, unknown> = {}
      chain.update = (value: Record<string, unknown>) => { op = 'update'; patch = value; return chain }
      chain.insert = (value: Record<string, unknown>) => { op = 'insert'; inserted = value; return chain }
      chain.upsert = (value: Record<string, unknown>) => { op = 'upsert'; inserted = value; return chain }
      chain.select = () => chain
      chain.eq = (key: string, value: unknown) => { filters.push([key, value]); return chain }
      chain.maybeSingle = async () => {
        const { data, error } = run()
        return { data: data?.[0] ?? null, error }
      }
      chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(run()).then(resolve, reject)
      return chain
    },
  }),
}))

vi.mock('@/lib/bookings/discoveryAnchor', () => ({ recordDiscoveryAnchor: anchors.discovery }))
vi.mock('@/lib/bookings/pmpsAnchor', () => ({ recordPmpsAnchor: anchors.pmps }))
vi.mock('@/lib/appointments/calendarSync', () => ({
  cancelAppointmentEvent: anchors.cancelEvent,
  rescheduleAppointmentEvent: anchors.moveEvent,
}))
vi.mock('@/lib/appointments/teamsMeeting', () => ({
  cancelAppointmentTeamsMeeting: anchors.cancelTeams,
  rescheduleAppointmentTeamsMeeting: anchors.moveTeams,
}))

import { correctExternalAppointment } from '@/lib/appointments/externalCorrection'

const TYPE: AppointmentType = {
  id: 'type-1', key: 'discovery_call', slug: 'discovery', label: 'Discovery Call',
  description: '', durationMinutes: 30, locationType: 'phone', locationTypes: ['phone'],
  active: true, public: true, sort: 0, customWeeklyHours: null, bookingQuestions: [],
}

function appointment(overrides: Partial<AppointmentRow> = {}): AppointmentRow {
  return {
    id: 'appt-1',
    appointment_type_id: 'type-1',
    start_time: '2026-11-02T15:00:00.000Z',
    end_time: '2026-11-02T15:45:00.000Z',
    status: 'scheduled',
    location_type: 'phone',
    attendee_name: 'Ada Client',
    attendee_email: 'ada@example.com',
    attendee_phone: null,
    second_attendee_name: null,
    second_attendee_email: null,
    notes: 'Managed in Lawmatics.',
    linked_lead_id: 'lead-1',
    linked_matter_id: 'matter-1',
    booked_by_user_id: null,
    google_event_id: null,
    manage_token_hash: null,
    manage_token_expires_at: null,
    reminder_sent_at: '2026-11-01T15:00:00.000Z',
    online_meeting_url: null,
    source: 'lawmatics',
    external_booking_uid: 'lm-event-9',
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  db.appointments = [appointment() as unknown as Record<string, unknown>]
  db.external_bookings = [{
    provider: 'lawmatics', booking_uid: 'lm-event-9', status: 'scheduled',
    start_time: '2026-11-02T15:00:00.000Z', end_time: '2026-11-02T15:45:00.000Z',
  }]
  db.lead_activity = []
  db.matter_notes = []
  db.matter_details = []
  for (const spy of Object.values(anchors)) spy.mockClear()
})

describe('correctExternalAppointment', () => {
  it('removes a Lawmatics meeting without emailing the client', async () => {
    await correctExternalAppointment({
      appointment: appointment(), type: TYPE, action: 'cancel', actorId: 'staff-1',
    })
    expect(db.appointments[0]).toMatchObject({ status: 'cancelled' })
    expect(db.external_bookings[0]).toMatchObject({ status: 'cancelled' })
    expect(db.lead_activity[0]).toMatchObject({
      lead_id: 'lead-1',
      event_type: 'note',
      title: 'Cancelled: Discovery Call',
      actor_id: 'staff-1',
    })
    expect(String(db.lead_activity[0].detail)).toContain('not emailed')
    expect(db.matter_notes[0]).toMatchObject({ matter_id: 'matter-1', author: 'Staff' })
    expect(anchors.discovery).not.toHaveBeenCalled()
    expect(anchors.cancelEvent).toHaveBeenCalledOnce()
  })

  it('moves a Lawmatics meeting and keeps its length', async () => {
    const result = await correctExternalAppointment({
      appointment: appointment(),
      type: TYPE,
      action: 'reschedule',
      newStartIso: '2026-11-04T18:00:00.000Z',
    })
    expect(result).toEqual({
      startIso: '2026-11-04T18:00:00.000Z',
      endIso: '2026-11-04T18:45:00.000Z',
    })
    expect(db.appointments[0]).toMatchObject({
      status: 'scheduled',
      start_time: '2026-11-04T18:00:00.000Z',
      end_time: '2026-11-04T18:45:00.000Z',
      reminder_sent_at: null,
    })
    expect(db.external_bookings[0]).toMatchObject({
      status: 'rescheduled',
      start_time: '2026-11-04T18:00:00.000Z',
      end_time: '2026-11-04T18:45:00.000Z',
    })
    expect(anchors.discovery).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      leadId: 'lead-1', matterId: 'matter-1', startIso: '2026-11-04T18:00:00.000Z', overwrite: true,
    }))
    expect(anchors.moveEvent).toHaveBeenCalledOnce()
  })

  it('leaves a Cornerstone booking on the normal path', async () => {
    await expect(correctExternalAppointment({
      appointment: appointment({ source: 'admin', external_booking_uid: null }),
      type: TYPE,
      action: 'cancel',
    })).rejects.toThrow(/Cornerstone/)
    expect(db.appointments[0].status).toBe('scheduled')
  })

  it('refuses to remove a meeting that is no longer scheduled', async () => {
    db.appointments[0].status = 'no_show'
    await expect(correctExternalAppointment({
      appointment: appointment(), type: TYPE, action: 'cancel',
    })).rejects.toThrow(/scheduled/)
    expect(db.external_bookings[0].status).toBe('scheduled')
  })
})
