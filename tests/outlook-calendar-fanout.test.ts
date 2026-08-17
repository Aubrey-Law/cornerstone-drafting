import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const getAccessToken = vi.fn(async () => 'token')
const getMicrosoftConnectionForUser = vi.fn(async () => ({ user_id: 'user-1' }))
vi.mock('@/lib/microsoftCalendar', () => ({
  getAccessToken: (...args: unknown[]) => getAccessToken(...(args as [])),
  getMicrosoftConnectionForUser: (...args: unknown[]) =>
    getMicrosoftConnectionForUser(...(args as [])),
}))

import { listCalendarView } from '@/lib/appointments/graphEvents'

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body, text: async () => '' } as Response
}

function event(id: string) {
  return {
    id,
    subject: id,
    isAllDay: false,
    isCancelled: false,
    showAs: 'busy',
    start: { dateTime: '2026-08-17T12:30:00.0000000' },
    end: { dateTime: '2026-08-17T13:00:00.0000000' },
  }
}

/**
 * Routes a fake Graph by URL. `calendarViews` maps calendar id -> events, and
 * an id present in `failing` errors the way Graph errors on the Birthdays and
 * subscribed holiday calendars.
 */
function stubGraph(options: {
  calendars?: Array<{ id: string; name: string; isDefaultCalendar?: boolean }> | 'error'
  defaultView?: unknown[] | 'error'
  calendarViews?: Record<string, unknown[]>
  failing?: string[]
}) {
  const failing = new Set(options.failing ?? [])
  return vi.fn(async (url: string) => {
    if (url.includes('/me/calendars?')) {
      if (options.calendars === 'error') {
        return jsonResponse({ error: { message: 'no calendar list' } }, 403)
      }
      return jsonResponse({ value: options.calendars ?? [] })
    }
    const perCalendar = url.match(/\/me\/calendars\/([^/]+)\/calendarView/)
    if (perCalendar) {
      const id = decodeURIComponent(perCalendar[1])
      if (failing.has(id)) {
        return jsonResponse({ error: { message: `cannot read ${id}` } }, 500)
      }
      return jsonResponse({ value: options.calendarViews?.[id] ?? [] })
    }
    if (options.defaultView === 'error') {
      return jsonResponse({ error: { message: 'mailbox unavailable' } }, 503)
    }
    return jsonResponse({ value: options.defaultView ?? [] })
  })
}

const FROM = '2026-08-17T00:00:00.000Z'
const TO = '2026-08-24T00:00:00.000Z'

beforeEach(() => {
  vi.restoreAllMocks()
  getAccessToken.mockResolvedValue('token')
  getMicrosoftConnectionForUser.mockResolvedValue({ user_id: 'user-1' })
})

describe('listCalendarView fan-out', () => {
  it('keeps the view when one calendar errors, and reports it as skipped', async () => {
    vi.stubGlobal('fetch', stubGraph({
      calendars: [
        { id: 'primary', name: 'Calendar', isDefaultCalendar: true },
        { id: 'birthdays', name: 'Birthdays' },
        { id: 'court', name: 'Court dates' },
      ],
      defaultView: [event('primary-1')],
      calendarViews: { court: [event('court-1')] },
      failing: ['birthdays'],
    }))

    const view = await listCalendarView(FROM, TO)

    expect((view.raw as Array<{ id: string }>).map(e => e.id).sort())
      .toEqual(['court-1', 'primary-1'])
    expect(view.skipped).toEqual(['Birthdays'])
    expect(view.calendars.map(c => c.name)).toEqual(['Calendar', 'Court dates'])
  })

  it('still returns the default calendar when every extra calendar errors', async () => {
    vi.stubGlobal('fetch', stubGraph({
      calendars: [
        { id: 'primary', name: 'Calendar', isDefaultCalendar: true },
        { id: 'birthdays', name: 'Birthdays' },
        { id: 'holidays', name: 'United States holidays' },
      ],
      defaultView: [event('primary-1')],
      failing: ['birthdays', 'holidays'],
    }))

    const view = await listCalendarView(FROM, TO)

    expect((view.raw as Array<{ id: string }>).map(e => e.id)).toEqual(['primary-1'])
    expect(view.skipped.sort()).toEqual(['Birthdays', 'United States holidays'])
  })

  it('falls back to the default calendar when the calendar list is unreadable', async () => {
    vi.stubGlobal('fetch', stubGraph({ calendars: 'error', defaultView: [event('primary-1')] }))

    const view = await listCalendarView(FROM, TO)

    expect((view.raw as Array<{ id: string }>).map(e => e.id)).toEqual(['primary-1'])
    expect(view.calendars).toEqual([])
    expect(view.skipped).toEqual([])
  })

  it('throws only when the default calendar itself cannot be read', async () => {
    vi.stubGlobal('fetch', stubGraph({ defaultView: 'error' }))
    await expect(listCalendarView(FROM, TO)).rejects.toThrow('mailbox unavailable')
  })

  it('tags default-calendar events with the default calendar name', async () => {
    vi.stubGlobal('fetch', stubGraph({
      calendars: [{ id: 'primary', name: 'Calendar', isDefaultCalendar: true }],
      defaultView: [event('primary-1')],
    }))

    const view = await listCalendarView(FROM, TO)
    expect(view.raw[0]).toMatchObject({ calendarId: 'primary', calendarName: 'Calendar' })
  })
})
