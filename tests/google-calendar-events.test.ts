import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getConnection: vi.fn(),
  getAccessToken: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))
vi.mock('@/lib/googleCalendar', () => ({
  getGoogleConnectionForUser: mocks.getConnection,
  getAccessToken: mocks.getAccessToken,
}))

import {
  cancelCalendarEvent,
  createCalendarEvent,
  rescheduleCalendarEvent,
} from '@/lib/appointments/googleEvents'
import type { CreateEventInput } from '@/lib/appointments/calendarTypes'

function input(overrides: Partial<CreateEventInput> = {}): CreateEventInput {
  return {
    type: { label: 'Discovery call', locationType: 'phone' },
    startIso: '2026-09-10T14:00:00.000Z',
    endIso: '2026-09-10T14:30:00.000Z',
    attendeeName: 'Jane Client',
    attendeeEmail: 'jane@example.com',
    attendeePhone: '617-555-0100',
    ...overrides,
  } as unknown as CreateEventInput
}

let fetchMock: ReturnType<typeof vi.fn>

function respond(body: unknown, status = 200) {
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }))
}

function lastCall(): { url: string; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit]
  return { url, init }
}

function sentBody(): Record<string, unknown> {
  return JSON.parse(String(lastCall().init.body))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getConnection.mockResolvedValue({ user_id: 'user-1' })
  mocks.getAccessToken.mockResolvedValue('token-abc')
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

describe('creating a Google event', () => {
  it('asks Google to email the attendee, which it does not do on its own', async () => {
    // Google sends nothing without sendUpdates=all and reports success either
    // way, so omitting it produces a calendar that looks right while the client
    // is never told.
    respond({ id: 'evt-1' })

    await createCalendarEvent(input())

    expect(lastCall().url).toContain('sendUpdates=all')
  })

  it('returns the event id and no meeting link for a phone appointment', async () => {
    respond({ id: 'evt-1' })

    expect(await createCalendarEvent(input())).toEqual({
      eventId: 'evt-1',
      onlineMeetingUrl: null,
    })
    expect(sentBody().conferenceData).toBeUndefined()
  })

  it('requests a Meet link for an online appointment, with the version flag Google requires', async () => {
    // Without conferenceDataVersion=1 Google ignores conferenceData entirely and
    // returns a successfully created event with no link — a video appointment
    // nobody can join.
    respond({ id: 'evt-1', hangoutLink: 'https://meet.google.com/abc' })

    const created = await createCalendarEvent(
      input({ type: { label: 'Consult', locationType: 'teams' } as CreateEventInput['type'] }),
    )

    expect(lastCall().url).toContain('conferenceDataVersion=1')
    expect(sentBody().conferenceData).toBeTruthy()
    expect(created.onlineMeetingUrl).toBe('https://meet.google.com/abc')
  })

  it('falls back to the conference entry point when hangoutLink is absent', async () => {
    respond({
      id: 'evt-1',
      conferenceData: { entryPoints: [
        { entryPointType: 'phone', uri: 'tel:+1' },
        { entryPointType: 'video', uri: 'https://meet.google.com/xyz' },
      ] },
    })

    const created = await createCalendarEvent(
      input({ type: { label: 'Consult', locationType: 'teams' } as CreateEventInput['type'] }),
    )

    expect(created.onlineMeetingUrl).toBe('https://meet.google.com/xyz')
  })

  it('sends a plain-text description, because Google shows stray HTML as tags', async () => {
    respond({ id: 'evt-1' })

    await createCalendarEvent(input({ notes: 'Wants to discuss the trust' }))

    const description = String(sentBody().description)
    expect(description).not.toMatch(/<p>|<\/p>/)
    expect(description).toContain('Wants to discuss the trust')
  })

  it('includes a second attendee when there is one', async () => {
    respond({ id: 'evt-1' })

    await createCalendarEvent(
      input({ secondAttendeeEmail: 'sam@example.com', secondAttendeeName: 'Sam Client' }),
    )

    expect(sentBody().attendees).toEqual([
      { email: 'jane@example.com', displayName: 'Jane Client' },
      { email: 'sam@example.com', displayName: 'Sam Client' },
    ])
  })

  it('refuses a response with no id rather than storing an empty event reference', async () => {
    respond({})

    await expect(createCalendarEvent(input())).rejects.toThrow(/no id/i)
  })

  it('says the calendar is not connected rather than failing deeper in', async () => {
    mocks.getConnection.mockResolvedValue(null)

    await expect(createCalendarEvent(input())).rejects.toThrow(/not connected/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('cancelling a Google event', () => {
  it('treats an event that is already gone as cancelled', async () => {
    // 404 never existed, 410 already deleted. Both are the state a cancel wants,
    // and throwing would log a failure for work that is done.
    for (const status of [404, 410]) {
      fetchMock.mockResolvedValue(new Response('', { status }))
      await expect(cancelCalendarEvent('evt-1')).resolves.toBeUndefined()
    }
  })

  it('asks Google to email the cancellation', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await cancelCalendarEvent('evt-1')

    expect(lastCall().url).toContain('sendUpdates=all')
    expect(lastCall().init.method).toBe('DELETE')
  })

  it('reports a real failure', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }))

    await expect(cancelCalendarEvent('evt-1')).rejects.toThrow(/cancel failed \(500\)/)
  })
})

describe('rescheduling a Google event', () => {
  it('patches the times and emails the update', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'evt-1' }), { status: 200 }))

    await rescheduleCalendarEvent('evt-1', '2026-09-11T15:00:00.000Z', '2026-09-11T15:30:00.000Z')

    expect(lastCall().init.method).toBe('PATCH')
    expect(lastCall().url).toContain('sendUpdates=all')
    expect(sentBody()).toEqual({
      start: { dateTime: '2026-09-11T15:00:00.000Z', timeZone: 'UTC' },
      end: { dateTime: '2026-09-11T15:30:00.000Z', timeZone: 'UTC' },
    })
  })

  it('escapes an event id rather than pasting it into the URL', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))

    await cancelCalendarEvent('evt/with spaces')

    expect(lastCall().url).toContain(encodeURIComponent('evt/with spaces'))
  })
})
