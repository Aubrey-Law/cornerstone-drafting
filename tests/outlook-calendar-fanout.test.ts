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
  it('bounds concurrent secondary reads and keeps every successful calendar in mailbox order', async () => {
    const calendars = Array.from({ length: 7 }, (_, i) => ({ id: `extra-${i}`, name: `Extra ${i}` }))
    const base = stubGraph({
      calendars: [{ id: 'primary', name: 'Calendar', isDefaultCalendar: true }, ...calendars],
      defaultView: [event('primary-1')],
    })
    let active = 0
    let peak = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const match = url.match(/\/me\/calendars\/([^/]+)\/calendarView/)
      if (!match) return base(url)
      active++
      peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 0))
      active--
      return jsonResponse({ value: [event(match[1])] })
    }))

    const view = await listCalendarView(FROM, TO)

    expect(peak).toBeLessThanOrEqual(2)
    expect(peak).toBeGreaterThan(1)
    expect(view.skipped).toEqual([])
    expect(view.calendars.map(c => c.id)).toEqual(['primary', ...calendars.map(c => c.id)])
    expect((view.raw as Array<{ id: string }>).map(e => e.id))
      .toEqual(['primary-1', ...calendars.map(c => c.id)])
  })

  it('stops secondary pagination at the shared deadline without discarding the primary calendar', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    let now = 100_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const base = stubGraph({
      calendars: [{ id: 'primary', name: 'Calendar', isDefaultCalendar: true }, { id: 'slow', name: 'Slow' }],
      defaultView: [event('primary-1')],
    })
    const signals: AbortSignal[] = []
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (!url.includes('/me/calendars/slow/calendarView')) return base(url)
      signals.push(init?.signal as AbortSignal)
      now += 6_001
      return jsonResponse({ value: [], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/secondary-next' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const view = await listCalendarView(FROM, TO)

    expect(fetchMock.mock.calls.some(([url]) => url.includes('secondary-next'))).toBe(false)
    expect(signals).toHaveLength(1)
    expect(signals[0]).toBeInstanceOf(AbortSignal)
    expect(timeout).toHaveBeenCalledWith(6_000)
    expect(view.skipped).toEqual(['Slow'])
    expect((view.raw as Array<{ id: string }>).map(e => e.id)).toEqual(['primary-1'])
  })

  it('aborts stalled secondary requests and skips queued calendars when the budget expires', async () => {
    let now = 100_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
      const controller = new AbortController()
      if (ms === 6_000) queueMicrotask(() => {
        now = 106_001
        controller.abort(new DOMException('budget expired', 'TimeoutError'))
      })
      return controller.signal
    })
    const base = stubGraph({
      calendars: [
        { id: 'primary', name: 'Calendar', isDefaultCalendar: true },
        ...['first', 'second', 'queued'].map(id => ({ id, name: id })),
      ],
      defaultView: [event('primary-1')],
    })
    const started: string[] = []
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const match = url.match(/\/me\/calendars\/([^/]+)\/calendarView/)
      if (!match) return base(url)
      started.push(match[1])
      const signal = init?.signal
      return new Promise<Response>((_resolve, reject) => {
        if (!signal) return reject(new Error('missing request deadline'))
        if (signal.aborted) return reject(signal.reason)
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    }))

    const view = await listCalendarView(FROM, TO)

    expect(started).toEqual(['first', 'second'])
    expect(view.skipped).toEqual(['first', 'second', 'queued'])
    expect((view.raw as Array<{ id: string }>).map(e => e.id)).toEqual(['primary-1'])
  })

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
