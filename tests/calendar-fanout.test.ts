import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))

const getAccessToken = vi.fn(async () => 'token')
const getGoogleConnectionForUser = vi.fn(async () => ({ user_id: 'user-1' }))
vi.mock('@/lib/googleCalendar', () => ({
  getAccessToken: (...args: unknown[]) => getAccessToken(...(args as [])),
  getGoogleConnectionForUser: (...args: unknown[]) =>
    getGoogleConnectionForUser(...(args as [])),
}))

import { listCalendarView } from '@/lib/appointments/googleEvents'

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body, text: async () => '' } as Response
}

function event(id: string) {
  return {
    id,
    summary: id,
    status: 'confirmed',
    start: { dateTime: '2026-08-17T12:30:00Z' },
    end: { dateTime: '2026-08-17T13:00:00Z' },
  }
}

/**
 * Routes a fake Google Calendar by URL. `calendarEvents` maps calendar id ->
 * events, and an id in `failing` errors the way Google errors on birthday and
 * subscribed holiday calendars.
 */
function stubGoogle(options: {
  calendars?: Array<{ id: string; summary: string; primary?: boolean }> | 'error'
  primaryEvents?: unknown[] | 'error'
  calendarEvents?: Record<string, unknown[]>
  failing?: string[]
}) {
  const failing = new Set(options.failing ?? [])
  return vi.fn(async (url: string) => {
    if (url.includes('/users/me/calendarList')) {
      if (options.calendars === 'error') return jsonResponse({ error: 'no list' }, 403)
      return jsonResponse({ items: options.calendars ?? [] })
    }
    const perCalendar = url.match(/\/calendars\/([^/]+)\/events/)
    const id = perCalendar ? decodeURIComponent(perCalendar[1]) : 'primary'
    if (id === 'primary') {
      if (options.primaryEvents === 'error') return jsonResponse({ error: 'unavailable' }, 503)
      return jsonResponse({ items: options.primaryEvents ?? [] })
    }
    if (failing.has(id)) return jsonResponse({ error: `cannot read ${id}` }, 500)
    return jsonResponse({ items: options.calendarEvents?.[id] ?? [] })
  })
}

const FROM = '2026-08-17T00:00:00.000Z'
const TO = '2026-08-24T00:00:00.000Z'

beforeEach(() => {
  vi.restoreAllMocks()
  getAccessToken.mockResolvedValue('token')
  getGoogleConnectionForUser.mockResolvedValue({ user_id: 'user-1' })
})

describe('listCalendarView fan-out', () => {
  it('keeps the view when one calendar errors, and reports it as skipped', async () => {
    vi.stubGlobal('fetch', stubGoogle({
      calendars: [
        { id: 'primary', summary: 'Aubrey Law', primary: true },
        { id: 'birthdays', summary: 'Birthdays' },
        { id: 'court', summary: 'Court dates' },
      ],
      primaryEvents: [event('primary-1')],
      calendarEvents: { court: [event('court-1')] },
      failing: ['birthdays'],
    }))

    const view = await listCalendarView(FROM, TO)

    expect((view.raw as Array<{ id: string }>).map(e => e.id).sort())
      .toEqual(['court-1', 'primary-1'])
    expect(view.skipped).toEqual(['Birthdays'])
    expect(view.calendars.map(c => c.name)).toEqual(['Aubrey Law', 'Court dates'])
  })

  it('still returns the primary calendar when every extra calendar errors', async () => {
    vi.stubGlobal('fetch', stubGoogle({
      calendars: [
        { id: 'primary', summary: 'Aubrey Law', primary: true },
        { id: 'birthdays', summary: 'Birthdays' },
        { id: 'holidays', summary: 'United States holidays' },
      ],
      primaryEvents: [event('primary-1')],
      failing: ['birthdays', 'holidays'],
    }))

    const view = await listCalendarView(FROM, TO)

    expect((view.raw as Array<{ id: string }>).map(e => e.id)).toEqual(['primary-1'])
    expect(view.skipped.sort()).toEqual(['Birthdays', 'United States holidays'])
  })

  it('falls back to the primary calendar when the calendar list is unreadable', async () => {
    vi.stubGlobal('fetch', stubGoogle({ calendars: 'error', primaryEvents: [event('primary-1')] }))

    const view = await listCalendarView(FROM, TO)

    expect((view.raw as Array<{ id: string }>).map(e => e.id)).toEqual(['primary-1'])
    expect(view.calendars).toEqual([])
    expect(view.skipped).toEqual([])
  })

  it('throws only when the primary calendar itself cannot be read', async () => {
    vi.stubGlobal('fetch', stubGoogle({ primaryEvents: 'error' }))
    await expect(listCalendarView(FROM, TO)).rejects.toThrow(/events list failed \(503\)/)
  })

  it('tags primary-calendar events with the primary calendar name', async () => {
    vi.stubGlobal('fetch', stubGoogle({
      calendars: [{ id: 'primary', summary: 'Aubrey Law', primary: true }],
      primaryEvents: [event('primary-1')],
    }))

    const view = await listCalendarView(FROM, TO)
    expect(view.raw[0]).toMatchObject({ calendarId: 'primary', calendarName: 'Aubrey Law' })
  })

  it('asks for deleted events, so a cancellation made in Google still reconciles', async () => {
    const fetchMock = stubGoogle({ primaryEvents: [event('primary-1')] })
    vi.stubGlobal('fetch', fetchMock)
    await listCalendarView(FROM, TO)
    expect(fetchMock.mock.calls[0][0]).toContain('showDeleted=true')
  })
})
