import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  googleCreate: vi.fn(),
  googleCancel: vi.fn(),
  googleReschedule: vi.fn(),
  googleAttendees: vi.fn(),
  outlookCancel: vi.fn(),
  outlookReschedule: vi.fn(),
  outlookAttendees: vi.fn(),
}))

vi.mock('@/lib/appointments/googleEvents', () => ({
  createCalendarEvent: mocks.googleCreate,
  cancelCalendarEvent: mocks.googleCancel,
  rescheduleCalendarEvent: mocks.googleReschedule,
  getCalendarEventAttendees: mocks.googleAttendees,
}))
vi.mock('@/lib/appointments/legacyOutlookEvents', () => ({
  cancelCalendarEvent: mocks.outlookCancel,
  rescheduleCalendarEvent: mocks.outlookReschedule,
  getCalendarEventAttendees: mocks.outlookAttendees,
}))

import {
  appointmentEventAttendees,
  cancelAppointmentEvent,
  createAppointmentEvent,
  eventIdColumn,
  rescheduleAppointmentEvent,
  targetForAppointment,
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

    expect(created).toEqual({ target: 'google', eventId: 'g-1', onlineMeetingUrl: 'https://meet' })
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

  it('files the new id in the column for the calendar that holds it', () => {
    expect(eventIdColumn('google')).toBe('google_event_id')
    expect(eventIdColumn('microsoft')).toBe('microsoft_event_id')
  })
})

describe('cancelling and rescheduling go back to where the event actually is', () => {
  it('cancels a legacy Outlook event in Outlook, not in Google', async () => {
    // The bug this exists to prevent: after the switchover, routing by the
    // *current* provider would leave every pre-existing appointment in Outlook
    // untouched — surfacing a week later as a client arriving for a meeting the
    // attorney believes they cancelled.
    await cancelAppointmentEvent({ microsoft_event_id: 'm-99', google_event_id: null })

    expect(mocks.outlookCancel).toHaveBeenCalledWith('m-99')
    expect(mocks.googleCancel).not.toHaveBeenCalled()
  })

  it('reschedules a legacy Outlook event in Outlook', async () => {
    await rescheduleAppointmentEvent(
      { microsoft_event_id: 'm-99', google_event_id: null },
      '2026-09-11T15:00:00.000Z',
      '2026-09-11T15:30:00.000Z',
    )

    expect(mocks.outlookReschedule).toHaveBeenCalledWith(
      'm-99',
      '2026-09-11T15:00:00.000Z',
      '2026-09-11T15:30:00.000Z',
    )
    expect(mocks.googleReschedule).not.toHaveBeenCalled()
  })

  it('cancels a Google event in Google', async () => {
    await cancelAppointmentEvent({ google_event_id: 'g-99', microsoft_event_id: null })

    expect(mocks.googleCancel).toHaveBeenCalledWith('g-99')
    expect(mocks.outlookCancel).not.toHaveBeenCalled()
  })

  it('does nothing for an appointment that never got a calendar event', async () => {
    await cancelAppointmentEvent({ google_event_id: null, microsoft_event_id: null })
    await rescheduleAppointmentEvent({}, '2026-09-11T15:00:00.000Z', '2026-09-11T15:30:00.000Z')

    expect(mocks.googleCancel).not.toHaveBeenCalled()
    expect(mocks.outlookCancel).not.toHaveBeenCalled()
    expect(mocks.googleReschedule).not.toHaveBeenCalled()
    expect(mocks.outlookReschedule).not.toHaveBeenCalled()
  })

  it('reads the target off the row, never off what is connected', () => {
    expect(targetForAppointment({ google_event_id: 'g' })).toBe('google')
    expect(targetForAppointment({ microsoft_event_id: 'm' })).toBe('microsoft')
    expect(targetForAppointment({})).toBeNull()
  })
})

describe('reading attendees', () => {
  it('asks whichever calendar holds the event, and neither when none does', async () => {
    mocks.googleAttendees.mockResolvedValue([{ name: 'Jane', email: 'j@e.com', status: 'accepted' }])
    mocks.outlookAttendees.mockResolvedValue([])

    await appointmentEventAttendees({ google_event_id: 'g-1' })
    expect(mocks.googleAttendees).toHaveBeenCalledWith('g-1')

    await appointmentEventAttendees({ microsoft_event_id: 'm-1' })
    expect(mocks.outlookAttendees).toHaveBeenCalledWith('m-1')

    expect(await appointmentEventAttendees({})).toEqual([])
  })
})
