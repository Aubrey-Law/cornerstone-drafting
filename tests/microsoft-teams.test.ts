import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getStored: vi.fn(),
  getAny: vi.fn(),
  store: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/calendarConnections', () => ({
  getStoredCalendarConnection: mocks.getStored,
  getAnyConnectionForProvider: mocks.getAny,
  storeCalendarConnection: mocks.store,
}))

import {
  createTeamsMeeting,
  deleteTeamsMeeting,
  getMicrosoftAccessToken,
  getMicrosoftAuthUrl,
  hasTeamsScope,
  rescheduleTeamsMeeting,
  toMicrosoftDisplayError,
} from '@/lib/microsoftTeams'
import { locationLine } from '@/lib/appointments/emailFormat'
import type { AppointmentType } from '@/lib/appointments/types'

let fetchMock: ReturnType<typeof vi.fn>

function lastCall(): { url: string; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit]
  return { url, init }
}

const liveConnection = {
  user_id: 'user-1',
  access_token: 'live-token',
  refresh_token: 'refresh-1',
  expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  email: 'scott@aubreylegal.com',
  scopes: 'OnlineMeetings.ReadWrite User.Read',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('MICROSOFT_CLIENT_ID', 'client-id')
  vi.stubEnv('MICROSOFT_CLIENT_SECRET', 'client-secret')
  vi.stubEnv('MICROSOFT_REDIRECT_URI', 'https://app.test/api/admin/microsoft/callback')
  vi.stubEnv('MICROSOFT_TENANT_ID', '')
  mocks.getStored.mockResolvedValue(null)
  mocks.getAny.mockResolvedValue(liveConnection)
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

describe('Microsoft consent', () => {
  it('asks for a refresh token and the Teams scope on a work-account tenant', () => {
    const url = new URL(getMicrosoftAuthUrl('state-1'))
    expect(url.pathname).toBe('/organizations/oauth2/v2.0/authorize')
    const scope = url.searchParams.get('scope') ?? ''
    expect(scope).toContain('offline_access')
    expect(scope).toContain('OnlineMeetings.ReadWrite')
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.test/api/admin/microsoft/callback')
    expect(url.searchParams.get('state')).toBe('state-1')
  })

  it('uses the firm tenant when one is set', () => {
    vi.stubEnv('MICROSOFT_TENANT_ID', 'tenant-123')
    expect(new URL(getMicrosoftAuthUrl()).pathname).toBe('/tenant-123/oauth2/v2.0/authorize')
  })

  it('tells the attorney to set the tenant when a single-tenant app refuses the shared endpoint', () => {
    expect(toMicrosoftDisplayError('AADSTS50194: Application is not configured as a multi-tenant application.'))
      .toMatch(/MICROSOFT_TENANT_ID/)
  })

  it('recognises the Teams scope bare or as a Graph URL', () => {
    expect(hasTeamsScope('User.Read OnlineMeetings.ReadWrite')).toBe(true)
    expect(hasTeamsScope('https://graph.microsoft.com/OnlineMeetings.ReadWrite')).toBe(true)
    expect(hasTeamsScope('User.Read')).toBe(false)
    expect(hasTeamsScope(null)).toBe(false)
  })
})

describe('Microsoft tokens', () => {
  it('refreshes an expired token and stores the rotated refresh token', async () => {
    mocks.getAny.mockResolvedValue({ ...liveConnection, expires_at: new Date(Date.now() - 1000).toISOString() })
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      access_token: 'new-token',
      refresh_token: 'refresh-2',
      expires_in: 3600,
      scope: 'OnlineMeetings.ReadWrite',
    }), { status: 200 }))

    expect(await getMicrosoftAccessToken()).toBe('new-token')
    expect(lastCall().url).toContain('/oauth2/v2.0/token')
    expect(mocks.store).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'microsoft',
      access_token: 'new-token',
      refresh_token: 'refresh-2',
    }))
  })

  it('says Teams is not connected when there is no connection', async () => {
    mocks.getAny.mockResolvedValue(null)
    await expect(createTeamsMeeting({ subject: 'x', startIso: 'a', endIso: 'b' })).rejects.toThrow(/not connected/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('Teams meetings', () => {
  it('creates a meeting and returns its join link', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      id: 'mtg-1',
      joinWebUrl: 'https://teams.microsoft.com/l/meetup-join/abc',
    }), { status: 201 }))

    const meeting = await createTeamsMeeting({
      subject: 'Consult — Jane Client',
      startIso: '2026-10-05T14:00:00.000Z',
      endIso: '2026-10-05T15:00:00.000Z',
    })

    expect(meeting).toEqual({ id: 'mtg-1', joinUrl: 'https://teams.microsoft.com/l/meetup-join/abc' })
    expect(lastCall().url).toBe('https://graph.microsoft.com/v1.0/me/onlineMeetings')
    expect(lastCall().init.method).toBe('POST')
    expect((lastCall().init.headers as Record<string, string>).Authorization).toBe('Bearer live-token')
    expect(JSON.parse(String(lastCall().init.body))).toEqual({
      subject: 'Consult — Jane Client',
      startDateTime: '2026-10-05T14:00:00.000Z',
      endDateTime: '2026-10-05T15:00:00.000Z',
    })
  })

  it('refuses a created meeting with no join link', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'mtg-1' }), { status: 201 }))
    await expect(createTeamsMeeting({ subject: 'x', startIso: 'a', endIso: 'b' })).rejects.toThrow(/no join link/i)
  })

  it('moves and deletes a meeting by id, treating an already-deleted one as done', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
    await rescheduleTeamsMeeting('mtg/1', '2026-10-06T14:00:00.000Z', '2026-10-06T15:00:00.000Z')
    expect(lastCall().init.method).toBe('PATCH')
    expect(lastCall().url).toContain(encodeURIComponent('mtg/1'))

    fetchMock.mockResolvedValue(new Response('', { status: 404 }))
    await expect(deleteTeamsMeeting('mtg-1')).resolves.toBeUndefined()
  })
})

describe('email location line', () => {
  const type = { label: 'Consult', locationType: 'teams' } as AppointmentType

  it('names Teams when the meeting is on Teams', () => {
    expect(locationLine(type, null, 'https://teams.microsoft.com/x', 'microsoft_teams')).toContain('Microsoft Teams')
  })

  it('names Teams even for a phone appointment that had a Teams meeting added', () => {
    const phone = { ...type, locationType: 'phone' } as AppointmentType
    expect(locationLine(phone, null, 'https://teams.microsoft.com/x', 'microsoft_teams')).toContain('Microsoft Teams')
  })

  it('keeps Google Meet as the default virtual meeting', () => {
    expect(locationLine(type, null, 'https://meet.google.com/x')).toContain('Google Meet')
  })
})
