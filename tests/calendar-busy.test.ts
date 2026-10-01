import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const mocks = vi.hoisted(() => ({
  getConnection: vi.fn(),
  getAccessToken: vi.fn(),
}))
vi.mock('@/lib/googleCalendar', () => ({
  getGoogleConnectionForUser: mocks.getConnection,
  getAccessToken: mocks.getAccessToken,
}))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: vi.fn() }))

const getSchedulingSettings = vi.fn(async () => ({
  hiddenCalendarIds: [] as string[],
  blockingCalendarIds: [] as string[],
}))
vi.mock('@/lib/appointments/settings', () => ({
  getSchedulingSettings: () => getSchedulingSettings(),
}))

import {
  AvailabilityUnavailableError,
  fetchCalendarBusy,
} from '@/lib/appointments/calendarBusy'

const FROM = new Date('2026-09-10T00:00:00.000Z')
const TO = new Date('2026-09-11T00:00:00.000Z')

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body, text: async () => '' } as Response
}

beforeEach(() => {
  vi.restoreAllMocks()
  mocks.getConnection.mockResolvedValue({ user_id: 'user-1', email: 'firm@example.com' })
  mocks.getAccessToken.mockResolvedValue('token')
  getSchedulingSettings.mockResolvedValue({ hiddenCalendarIds: [], blockingCalendarIds: [] })
})

describe('fetchCalendarBusy', () => {
  it('returns the primary calendar’s busy blocks as UTC intervals', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      calendars: {
        primary: {
          busy: [
            { start: '2026-09-10T14:00:00Z', end: '2026-09-10T15:00:00Z' },
            { start: '2026-09-10T17:00:00-04:00', end: '2026-09-10T18:00:00-04:00' },
          ],
        },
      },
    })))

    expect(await fetchCalendarBusy(FROM, TO)).toEqual([
      { start: Date.parse('2026-09-10T14:00:00Z'), end: Date.parse('2026-09-10T15:00:00Z') },
      { start: Date.parse('2026-09-10T21:00:00Z'), end: Date.parse('2026-09-10T22:00:00Z') },
    ])
  })

  it('drops malformed and zero-length blocks rather than trusting them', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      calendars: {
        primary: {
          busy: [
            { start: 'garbage', end: '2026-09-10T15:00:00Z' },
            { start: '2026-09-10T16:00:00Z', end: '2026-09-10T16:00:00Z' },
            {},
          ],
        },
      },
    })))

    expect(await fetchCalendarBusy(FROM, TO)).toEqual([])
  })

  // Fails closed, every time: an unverifiable calendar must never read as a
  // free one, or the booking page offers a slot on top of a real meeting.
  it('throws when Google is not connected', async () => {
    mocks.getConnection.mockResolvedValue(null)
    await expect(fetchCalendarBusy(FROM, TO)).rejects.toBeInstanceOf(AvailabilityUnavailableError)
  })

  it('throws when the token cannot be acquired', async () => {
    mocks.getAccessToken.mockRejectedValue(new Error('refresh failed'))
    await expect(fetchCalendarBusy(FROM, TO)).rejects.toBeInstanceOf(AvailabilityUnavailableError)
  })

  it('applies the timeout to connection and token acquisition, not only freeBusy', async () => {
    mocks.getConnection.mockImplementation(() => new Promise(() => {}))
    await expect(fetchCalendarBusy(FROM, TO, { timeoutMs: 5 }))
      .rejects.toBeInstanceOf(AvailabilityUnavailableError)
  })

  it('throws when freeBusy errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'nope' }, 500)))
    await expect(fetchCalendarBusy(FROM, TO)).rejects.toBeInstanceOf(AvailabilityUnavailableError)
  })

  it('throws when freeBusy reports a per-calendar error instead of blocks', async () => {
    // A 200 carrying `errors` is the shape that would otherwise read as "no
    // busy time at all" — the single most dangerous wrong answer here.
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      calendars: { primary: { errors: [{ reason: 'notFound' }], busy: [] } },
    })))
    await expect(fetchCalendarBusy(FROM, TO)).rejects.toBeInstanceOf(AvailabilityUnavailableError)
  })
})

describe('fetchCalendarBusy blocking calendars', () => {
  it('asks only about primary when nothing else blocks', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse({ calendars: { primary: { busy: [] } } }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchCalendarBusy(FROM, TO)

    expect(mocks.getAccessToken).toHaveBeenCalledWith(
      'user-1',
      { connection: expect.objectContaining({ user_id: 'user-1' }) },
    )
    const [, init] = fetchMock.mock.calls[0]!
    const body = JSON.parse(String(init.body))
    expect(body.items).toEqual([{ id: 'primary' }])
  })

  it('sends primary plus each blocking calendar', async () => {
    getSchedulingSettings.mockResolvedValue({
      hiddenCalendarIds: [],
      blockingCalendarIds: ['personal@example.com'],
    })
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => jsonResponse({
      calendars: {
        primary: { busy: [] },
        'personal@example.com': { busy: [] },
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchCalendarBusy(FROM, TO)

    const [, init] = fetchMock.mock.calls[0]!
    const body = JSON.parse(String(init.body))
    expect(body.items).toEqual([{ id: 'primary' }, { id: 'personal@example.com' }])
  })

  it('merges busy blocks from a blocking calendar', async () => {
    getSchedulingSettings.mockResolvedValue({
      hiddenCalendarIds: [],
      blockingCalendarIds: ['personal@example.com'],
    })
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      calendars: {
        primary: { busy: [{ start: '2026-09-10T14:00:00Z', end: '2026-09-10T15:00:00Z' }] },
        'personal@example.com': {
          busy: [{ start: '2026-09-10T18:00:00Z', end: '2026-09-10T19:00:00Z' }],
        },
      },
    })))

    expect(await fetchCalendarBusy(FROM, TO)).toEqual([
      { start: Date.parse('2026-09-10T14:00:00Z'), end: Date.parse('2026-09-10T15:00:00Z') },
      { start: Date.parse('2026-09-10T18:00:00Z'), end: Date.parse('2026-09-10T19:00:00Z') },
    ])
  })

  // freeBusy reports per-calendar errors rather than failing the request, so an
  // unchecked error reads exactly like a free calendar. A calendar the firm
  // marked as blocking is one it asked to protect its time; dropping its error
  // quietly reopens the exact hole this feature closes.
  it('throws when a blocking calendar reports errors', async () => {
    getSchedulingSettings.mockResolvedValue({
      hiddenCalendarIds: [],
      blockingCalendarIds: ['personal@example.com'],
    })
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      calendars: {
        primary: { busy: [] },
        'personal@example.com': { errors: [{ domain: 'global', reason: 'notFound' }] },
      },
    })))

    await expect(fetchCalendarBusy(FROM, TO)).rejects.toBeInstanceOf(AvailabilityUnavailableError)
  })

  it('throws when a blocking calendar is missing from the response entirely', async () => {
    getSchedulingSettings.mockResolvedValue({
      hiddenCalendarIds: [],
      blockingCalendarIds: ['personal@example.com'],
    })
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      calendars: { primary: { busy: [] } },
    })))

    await expect(fetchCalendarBusy(FROM, TO)).rejects.toBeInstanceOf(AvailabilityUnavailableError)
  })

  // The other half of the rule: a calendar nobody asked to block must not be
  // able to take availability down.
  it('is unaffected by a calendar that does not block', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      calendars: {
        primary: { busy: [{ start: '2026-09-10T14:00:00Z', end: '2026-09-10T15:00:00Z' }] },
        'personal@example.com': { errors: [{ reason: 'notFound' }] },
      },
    })))

    expect(await fetchCalendarBusy(FROM, TO)).toEqual([
      { start: Date.parse('2026-09-10T14:00:00Z'), end: Date.parse('2026-09-10T15:00:00Z') },
    ])
  })
})
