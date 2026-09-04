import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAny: vi.fn(),
  googleCreate: vi.fn(),
  googleCancel: vi.fn(),
  googleReschedule: vi.fn(),
  graphCreate: vi.fn(),
  graphCancel: vi.fn(),
  graphReschedule: vi.fn(),
}))

vi.mock('@/lib/calendarConnections', () => ({ getAnyConnectionForProvider: mocks.getAny }))
vi.mock('@/lib/appointments/googleEvents', () => ({
  createCalendarEvent: mocks.googleCreate,
  cancelCalendarEvent: mocks.googleCancel,
  rescheduleCalendarEvent: mocks.googleReschedule,
}))
vi.mock('@/lib/appointments/graphEvents', () => ({
  createCalendarEvent: mocks.graphCreate,
  cancelCalendarEvent: mocks.graphCancel,
  rescheduleCalendarEvent: mocks.graphReschedule,
}))

import {
  cancelAppointmentEvent,
  createAppointmentEvent,
  eventIdColumn,
  rescheduleAppointmentEvent,
  resolveCalendarTarget,
  targetForAppointment,
} from '@/lib/appointments/calendarSync'
import type { CreateEventInput } from '@/lib/appointments/graphEvents'

const INPUT = {
  type: { label: 'Discovery call', locationType: 'phone' },
  startIso: '2026-09-10T14:00:00.000Z',
  endIso: '2026-09-10T14:30:00.000Z',
  attendeeName: 'Jane Client',
  attendeeEmail: 'jane@example.com',
} as unknown as CreateEventInput

function connected(provider: 'google' | 'microsoft' | 'none') {
  mocks.getAny.mockImplementation(async (p: string) =>
    provider !== 'none' && p === provider ? { user_id: 'user-1' } : null,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.googleCreate.mockResolvedValue({ eventId: 'g-1', onlineMeetingUrl: 'https://meet' })
  mocks.graphCreate.mockResolvedValue({ eventId: 'm-1', onlineMeetingUrl: null })
})

describe('choosing a calendar for a new booking', () => {
  it('prefers Google when it is connected, so switching over is a consent not a deploy', async () => {
    connected('google')

    const created = await createAppointmentEvent(INPUT)

    expect(created).toEqual({ target: 'google', eventId: 'g-1', onlineMeetingUrl: 'https://meet' })
    expect(mocks.graphCreate).not.toHaveBeenCalled()
  })

  it('falls back to Outlook while only Microsoft is connected', async () => {
    connected('microsoft')

    const created = await createAppointmentEvent(INPUT)

    expect(created?.target).toBe('microsoft')
    expect(mocks.googleCreate).not.toHaveBeenCalled()
  })

  it('keeps the booking when no calendar is connected rather than throwing', async () => {
    // The booking surviving a calendar failure is existing behaviour; "no
    // calendar at all" must not be the one case that takes the booking down.
    connected('none')

    expect(await createAppointmentEvent(INPUT)).toBeNull()
    expect(await resolveCalendarTarget()).toBeNull()
    expect(mocks.googleCreate).not.toHaveBeenCalled()
    expect(mocks.graphCreate).not.toHaveBeenCalled()
  })

  it('files the new id in the column for the calendar that holds it', () => {
    expect(eventIdColumn('google')).toBe('google_event_id')
    expect(eventIdColumn('microsoft')).toBe('microsoft_event_id')
  })
})

describe('cancelling and rescheduling go back to where the event actually is', () => {
  it('cancels an Outlook event in Outlook even once Google is the default', async () => {
    // The bug this exists to prevent: after the switchover, routing by the
    // *current* provider would leave every pre-existing appointment in Outlook
    // untouched — surfacing a week later as a client arriving for a meeting the
    // attorney believes they cancelled.
    connected('google')

    await cancelAppointmentEvent({ microsoft_event_id: 'm-99', google_event_id: null })

    expect(mocks.graphCancel).toHaveBeenCalledWith('m-99')
    expect(mocks.googleCancel).not.toHaveBeenCalled()
  })

  it('reschedules an Outlook event in Outlook even once Google is the default', async () => {
    connected('google')

    await rescheduleAppointmentEvent(
      { microsoft_event_id: 'm-99', google_event_id: null },
      '2026-09-11T15:00:00.000Z',
      '2026-09-11T15:30:00.000Z',
    )

    expect(mocks.graphReschedule).toHaveBeenCalledWith(
      'm-99',
      '2026-09-11T15:00:00.000Z',
      '2026-09-11T15:30:00.000Z',
    )
    expect(mocks.googleReschedule).not.toHaveBeenCalled()
  })

  it('cancels a Google event in Google even if only Microsoft is connected now', async () => {
    connected('microsoft')

    await cancelAppointmentEvent({ google_event_id: 'g-99', microsoft_event_id: null })

    expect(mocks.googleCancel).toHaveBeenCalledWith('g-99')
    expect(mocks.graphCancel).not.toHaveBeenCalled()
  })

  it('does nothing for an appointment that never got a calendar event', async () => {
    connected('google')

    await cancelAppointmentEvent({ google_event_id: null, microsoft_event_id: null })
    await rescheduleAppointmentEvent({}, '2026-09-11T15:00:00.000Z', '2026-09-11T15:30:00.000Z')

    expect(mocks.googleCancel).not.toHaveBeenCalled()
    expect(mocks.graphCancel).not.toHaveBeenCalled()
    expect(mocks.googleReschedule).not.toHaveBeenCalled()
    expect(mocks.graphReschedule).not.toHaveBeenCalled()
  })

  it('reads the target off the row, never off what is connected', () => {
    expect(targetForAppointment({ google_event_id: 'g' })).toBe('google')
    expect(targetForAppointment({ microsoft_event_id: 'm' })).toBe('microsoft')
    expect(targetForAppointment({})).toBeNull()
  })
})

describe('the rule the settings screen and the booking flow share', () => {
  it('names Google when connected, Outlook when only that is, nothing when neither', async () => {
    // One function, not two copies. A screen that confidently names a calendar
    // bookings do not go to is worse than a screen that says nothing.
    const { preferredTarget, CALENDAR_TARGET_LABEL } = await import(
      '@/lib/appointments/calendarTarget'
    )

    expect(preferredTarget({ google: true, microsoft: true })).toBe('google')
    expect(preferredTarget({ google: false, microsoft: true })).toBe('microsoft')
    expect(preferredTarget({ google: false, microsoft: false })).toBeNull()

    expect(CALENDAR_TARGET_LABEL.google).toBe('Google Calendar')
    expect(CALENDAR_TARGET_LABEL.microsoft).toBe('Outlook')
    expect(CALENDAR_TARGET_LABEL.none).toContain('nothing is connected')
  })

  it('is what resolveCalendarTarget actually dispatches on', async () => {
    connected('google')
    expect(await resolveCalendarTarget()).toBe('google')

    connected('microsoft')
    expect(await resolveCalendarTarget()).toBe('microsoft')

    connected('none')
    expect(await resolveCalendarTarget()).toBeNull()
  })
})
