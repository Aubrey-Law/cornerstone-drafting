import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  googleCreate: vi.fn(),
  googleCancel: vi.fn(),
  googleReschedule: vi.fn(),
  googleAttendees: vi.fn(),
}))

vi.mock('@/lib/appointments/googleEvents', () => ({
  createCalendarEvent: mocks.googleCreate,
  cancelCalendarEvent: mocks.googleCancel,
  rescheduleCalendarEvent: mocks.googleReschedule,
  getCalendarEventAttendees: mocks.googleAttendees,
}))

import {
  appointmentEventAttendees,
  cancelAppointmentEvent,
  createAppointmentEvent,
  eventIdForAppointment,
  rescheduleAppointmentEvent,
} from '@/lib/appointments/calendarSync'
import type { CreateEventInput } from '@/lib/appointments/calendarTypes'

const INPUT = {
  type: { label: 'Discovery call', locationType: 'phone' },
  startIso: '2026-09-10T14:00:00.000Z',
  endIso: '2026-09-10T14:30:00.000Z',
  attendeeName: 'Jane Client',
  attendeeEmail: 'jane@example.com',
} as unknown as CreateEventInput

beforeEach(() => {
  vi.clearAllMocks()
  mocks.googleCreate.mockResolvedValue({ eventId: 'g-1', onlineMeetingUrl: 'https://meet' })
})

describe('creating the event for a new booking', () => {
  it('writes to Google, the firm’s calendar', async () => {
    const created = await createAppointmentEvent(INPUT)

    expect(created).toEqual({ eventId: 'g-1', onlineMeetingUrl: 'https://meet' })
    expect(mocks.googleCreate).toHaveBeenCalledOnce()
  })

  it('keeps the booking when Google is not connected rather than throwing', async () => {
    // The booking surviving a calendar failure is existing behaviour; "no
    // calendar at all" must not be the one case that takes the booking down.
    mocks.googleCreate.mockRejectedValue(new Error('Google Calendar is not connected'))

    expect(await createAppointmentEvent(INPUT)).toBeNull()
  })

  it('still surfaces a real Google failure, which is not the same as disconnected', async () => {
    mocks.googleCreate.mockRejectedValue(new Error('Google Calendar event create failed (500)'))

    await expect(createAppointmentEvent(INPUT)).rejects.toThrow('event create failed')
  })
})

describe('cancelling and rescheduling act on the id the row carries', () => {
  it('cancels the appointment’s Google event', async () => {
    await cancelAppointmentEvent({ google_event_id: 'g-99' })

    expect(mocks.googleCancel).toHaveBeenCalledWith('g-99')
  })

  it('reschedules the appointment’s Google event', async () => {
    await rescheduleAppointmentEvent(
      { google_event_id: 'g-99' },
      '2026-09-11T15:00:00.000Z',
      '2026-09-11T15:30:00.000Z',
    )

    expect(mocks.googleReschedule).toHaveBeenCalledWith(
      'g-99',
      '2026-09-11T15:00:00.000Z',
      '2026-09-11T15:30:00.000Z',
    )
  })

  it('does nothing for an appointment that never got a calendar event', async () => {
    // Not merely "no throw": a booking with no event must not reach the
    // calendar API at all, or a null id would be sent as the string "null"
    // and delete whatever event happens to answer to it.
    await cancelAppointmentEvent({ google_event_id: null })
    await rescheduleAppointmentEvent({}, '2026-09-11T15:00:00.000Z', '2026-09-11T15:30:00.000Z')

    expect(mocks.googleCancel).not.toHaveBeenCalled()
    expect(mocks.googleReschedule).not.toHaveBeenCalled()
  })

  it('reads the event id off the row', () => {
    expect(eventIdForAppointment({ google_event_id: 'g' })).toBe('g')
    expect(eventIdForAppointment({ google_event_id: null })).toBeNull()
    expect(eventIdForAppointment({})).toBeNull()
  })
})

describe('reading attendees', () => {
  it('asks Google for the event’s attendees, and skips the call when there is no event', async () => {
    mocks.googleAttendees.mockResolvedValue([{ name: 'Jane', email: 'j@e.com', status: 'accepted' }])

    await appointmentEventAttendees({ google_event_id: 'g-1' })
    expect(mocks.googleAttendees).toHaveBeenCalledWith('g-1')

    mocks.googleAttendees.mockClear()
    expect(await appointmentEventAttendees({})).toEqual([])
    expect(mocks.googleAttendees).not.toHaveBeenCalled()
  })
})
