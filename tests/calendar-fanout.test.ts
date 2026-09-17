import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))

const getSchedulingSettings = vi.fn(async () => ({
  hiddenCalendarIds: [] as string[],
  blockingCalendarIds: [] as string[],
}))
vi.mock('@/lib/appointments/settings', () => ({
  getSchedulingSettings: () => getSchedulingSettings(),
}))

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
  getSchedulingSettings.mockResolvedValue({ hiddenCalendarIds: [], blockingCalendarIds: [] })
})

describe('listCalendarView fan-out', () => {
  it('bounds concurrent secondary reads and keeps every calendar in account order', async () => {
    const calendars = Array.from({ length: 7 }, (_, i) => ({ id: `extra-${i}`, summary: `Extra ${i}` }))
    const base = stubGoogle({
      calendars: [{ id: 'primary', summary: 'Aubrey Law', primary: true }, ...calendars],
      primaryEvents: [event('primary-1')],
    })
    let active = 0
    let peak = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const match = url.match(/\/calendars\/(extra-\d+)\/events/)
      if (!match) return base(url)
      active++
      peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 0))
      active--
      return jsonResponse({ items: [event(match[1])] })
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
    const base = stubGoogle({
      calendars: [
        { id: 'primary', summary: 'Aubrey Law', primary: true },
        { id: 'slow', summary: 'Slow' },
      ],
      primaryEvents: [event('primary-1')],
    })
    const signals: AbortSignal[] = []
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (!url.includes('/calendars/slow/events')) return base(url)
      signals.push(init?.signal as AbortSignal)
      now += 6_001
      return jsonResponse({ items: [], nextPageToken: 'page-2' })
    })
    vi.stubGlobal('fetch', fetchMock)

    const view = await listCalendarView(FROM, TO)

    expect(fetchMock.mock.calls.some(([url]) => url.includes('pageToken=page-2'))).toBe(false)
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
    const base = stubGoogle({
      calendars: [
        { id: 'primary', summary: 'Aubrey Law', primary: true },
        ...['first', 'second', 'queued'].map(id => ({ id, summary: id })),
      ],
      primaryEvents: [event('primary-1')],
    })
    const started: string[] = []
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const match = url.match(/\/calendars\/(first|second|queued)\/events/)
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

describe('listCalendarView hidden calendars', () => {
  it('never fetches a hidden calendar', async () => {
    const fetchMock = stubGoogle({
      calendars: [
        { id: 'primary', summary: 'Aubrey Law', primary: true },
        { id: 'personal@example.com', summary: 'Personal' },
        { id: 'holidays@example.com', summary: 'US Holidays' },
      ],
      primaryEvents: [event('primary-1')],
      calendarEvents: {
        'personal@example.com': [event('personal-1')],
        'holidays@example.com': [event('holiday-1')],
      },
    })
    vi.stubGlobal('fetch', fetchMock)
    getSchedulingSettings.mockResolvedValue({
      hiddenCalendarIds: ['holidays@example.com'],
      blockingCalendarIds: [],
    })

    const view = await listCalendarView(FROM, TO)

    // Hidden means not read, not merely filtered after paying for it.
    const urls = fetchMock.mock.calls.map(call => String(call[0]))
    expect(urls.some(url => url.includes('holidays%40example.com'))).toBe(false)
    expect(view.calendars.map(c => c.id)).toEqual(['primary', 'personal@example.com'])
  })

  it('reads the primary calendar even when its id is hidden', async () => {
    vi.stubGlobal('fetch', stubGoogle({
      calendars: [{ id: 'primary', summary: 'Aubrey Law', primary: true }],
      primaryEvents: [event('primary-1')],
    }))
    getSchedulingSettings.mockResolvedValue({
      hiddenCalendarIds: ['primary'],
      blockingCalendarIds: [],
    })

    const view = await listCalendarView(FROM, TO)

    expect(view.calendars.map(c => c.id)).toEqual(['primary'])
  })

  it('reads every calendar when nothing is hidden', async () => {
    vi.stubGlobal('fetch', stubGoogle({
      calendars: [
        { id: 'primary', summary: 'Aubrey Law', primary: true },
        { id: 'personal@example.com', summary: 'Personal' },
      ],
      primaryEvents: [event('primary-1')],
      calendarEvents: { 'personal@example.com': [event('personal-1')] },
    }))

    const view = await listCalendarView(FROM, TO)

    expect(view.calendars.map(c => c.id)).toEqual(['primary', 'personal@example.com'])
  })
})
