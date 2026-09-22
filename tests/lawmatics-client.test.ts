import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { inspect } from 'node:util'
import { cancelLawmaticsEvent, createLawmaticsEvent, createLawmaticsProspect, lawmaticsRequest, updateLawmaticsEvent } from '@/lib/integrations/lawmatics/client'
import type { LawmaticsEventInput } from '@/lib/integrations/lawmatics/types'
import { IntegrationError } from '@/lib/integrations/errors'
import { LawmaticsValidationError } from '@/lib/integrations/lawmatics/validation'
import { getLawmaticsAccessToken } from '@/lib/lawmatics'

vi.mock('@/lib/lawmatics', () => ({ getLawmaticsAccessToken: vi.fn() }))

const token = 'sensitive-token-prefix-and-entire-access-token'
const email = 'private-client@example.com'
const providerBody = `Provider rejected ${email} with ${token}`

beforeEach(() => {
  vi.mocked(getLawmaticsAccessToken).mockResolvedValue(token)
  vi.stubGlobal('fetch', vi.fn())
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, method).mockImplementation(() => {})
  }
})

const event: LawmaticsEventInput = {
  name: 'Estate consultation', description: 'Cornerstone appointment appointment-25',
  start: '2026-09-16T14:00:00Z', end: '2026-09-16T15:00:00Z', timezone: 'America/New_York',
  prospectId: '101', eventTypeId: '202', userIds: ['303', '304'], locationId: '405',
}

describe('Lawmatics resource contracts', () => {
  describe.each(['prospect', 'event'] as const)('%s creation', resourceType => {
    it.each([
      ['malformed JSON', providerBody],
      ['missing data', JSON.stringify({ message: providerBody })],
    ])('requires attention after successful create with %s instead of risking a duplicate', async (_description, body) => {
      vi.mocked(fetch).mockResolvedValue(new Response(body, { status: 201 }))
      const pending = resourceType === 'prospect'
        ? createLawmaticsProspect({ firstName: 'Jane', lastName: 'Doe', email })
        : createLawmaticsEvent(event)
      const error = await pending.catch(e => e)
      expect(error).toMatchObject({ provider: 'lawmatics', kind: 'attention', code: 'invalid_response', retryAfterMs: null })
      expectSafe(error)
      expect(fetch).toHaveBeenCalledTimes(1)
    })
  })

  it('creates a Prospect using only explicit contact fields', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ data: { id: '101', type: 'prospect', attributes: {}, relationships: {} } }))
    const input = { firstName: 'Jane', lastName: 'Doe', email, phone: '+16175550100', privateNotes: 'do not transmit' }
    await expect(createLawmaticsProspect(input)).resolves.toMatchObject({ id: '101', type: 'prospect' })
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('https://api.lawmatics.com/v1/prospects')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({ first_name: 'Jane', last_name: 'Doe', email, phone: '+16175550100' })
  })

  it('omits missing optional Prospect contact fields', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ data: { id: '101', type: 'prospect' } }))
    await createLawmaticsProspect({ firstName: 'Jane', lastName: 'Doe' })
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)).toEqual({ first_name: 'Jane', last_name: 'Doe' })
  })

  it.each(['create', 'update'] as const)('%s serializes configured IDs and disables invitations/reminders', async operation => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ data: { id: '25', type: 'event', attributes: {}, relationships: {} } }))
    const input = { ...event, send_invites: true, reminder_type: 'minutes', privateNotes: 'do not transmit' }
    const result = operation === 'create' ? await createLawmaticsEvent(input) : await updateLawmaticsEvent('25', input)
    expect(result).toMatchObject({ id: '25', type: 'event' })
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe(operation === 'create' ? 'https://api.lawmatics.com/v1/events' : 'https://api.lawmatics.com/v1/events/25')
    expect(init?.method).toBe(operation === 'create' ? 'POST' : 'PUT')
    expect(JSON.parse(init?.body as string)).toEqual({
      name: 'Estate consultation', description: 'Cornerstone appointment appointment-25',
      start_date: '2026-09-16T14:00:00Z', end_date: '2026-09-16T15:00:00Z', time_zone: 'America/New_York',
      eventable_type: 'Prospect', eventable_id: '101', event_type_id: '202',
      user_ids: ['303', '304'], location_id: '405', all_day: false,
      send_invites: false, reminder_type: null, reminder_delay_length: null,
    })
  })

  it('clears a removed location mapping on update', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ data: { id: '25', type: 'event' } }))
    await updateLawmaticsEvent('25', { ...event, locationId: undefined })
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)).toHaveProperty('location_id', null)
  })

  it.each([200, 204])('cancels without attendee notification and accepts HTTP %i', async status => {
    vi.mocked(fetch).mockResolvedValue(status === 204 ? new Response(null, { status }) : Response.json({ data: { id: '25', type: 'event' } }))
    await expect(cancelLawmaticsEvent('25')).resolves.toBeUndefined()
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('https://api.lawmatics.com/v1/events/25?notify_attendees=false')
    expect(init?.method).toBe('DELETE')
    expect(init?.body).toBeUndefined()
  })

  it('encodes event IDs so they cannot inject notification parameters', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }))
    await cancelLawmaticsEvent('25?notify_attendees=true')
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('https://api.lawmatics.com/v1/events/25%3Fnotify_attendees%3Dtrue?notify_attendees=false')
  })

  it.each([
    null, { type: 'event' }, { id: '', type: 'event' }, { id: '25', type: 'prospect' },
  ])('rejects invalid Event identities with safe attention errors', async data => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ data }))
    const error = await createLawmaticsEvent(event).catch(e => e)
    // A create may already have succeeded; an invalid identity requires review, not blind retries.
    expect(error).toMatchObject({ kind: 'attention', code: 'invalid_record' })
    expectSafe(error)
  })

  it('rejects a Prospect response without an identity before consumers can persist it', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ data: { id: null, type: 'prospect', attributes: { email } } }))
    const error = await createLawmaticsProspect({ firstName: 'Jane', lastName: 'Doe', email }).catch(e => e)
    expect(error).toMatchObject({ kind: 'attention', code: 'invalid_record' })
    expectSafe(error)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function expectSafe(error: unknown) {
  expect(error).toBeInstanceOf(IntegrationError)
  const output = inspect(error) + JSON.stringify(error) + inspect([
    vi.mocked(console.log).mock.calls, vi.mocked(console.info).mock.calls,
    vi.mocked(console.warn).mock.calls, vi.mocked(console.error).mock.calls,
    vi.mocked(console.debug).mock.calls,
  ])
  expect(output).not.toContain(email)
  expect(output).not.toContain(token.slice(0, 12))
}

describe('Lawmatics transport', () => {
  it('sends authenticated JSON and unwraps JSON:API data', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({
      data: { id: '25', type: 'event', attributes: { name: 'Consultation' }, relationships: {} },
      meta: { ignored: true },
    }))
    await expect(lawmaticsRequest('/v1/events', { method: 'POST', body: { name: 'Consultation' } }))
      .resolves.toEqual({ id: '25', type: 'event', attributes: { name: 'Consultation' }, relationships: {} })
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('https://api.lawmatics.com/v1/events')
    expect(init).toMatchObject({ method: 'POST', body: '{"name":"Consultation"}', cache: 'no-store', redirect: 'error' })
    const headers = new Headers(init?.headers)
    expect(headers.get('Authorization')).toBe(`Bearer ${token}`)
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(headers.get('Accept')).toBe('application/vnd.api+json')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it.each([
    ['7', 7000],
    ['Tue, 15 Sep 2026 14:00:09 GMT', 9000],
    ['Tue, 15 Sep 2026 13:59:00 GMT', 0],
    ['invalid', null],
    ['-7', null],
    [null, null],
  ])('honors Retry-After %s safely', async (retryAfter, retryAfterMs) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-15T14:00:00Z'))
    vi.mocked(fetch).mockResolvedValue(new Response(providerBody, {
      status: 429, headers: retryAfter === null ? {} : { 'Retry-After': retryAfter },
    }))
    const error = await lawmaticsRequest('/v1/events', { method: 'POST', body: {} }).catch(e => e)
    expect(error).toMatchObject({ provider: 'lawmatics', kind: 'retryable', code: 'rate_limited', retryAfterMs })
    expectSafe(error)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    [401, 'attention', 'authentication_required'],
    [403, 'attention', 'permission_denied'],
    [404, 'attention', 'not_found'],
    [422, 'attention', 'validation_failed'],
    [400, 'attention', 'request_rejected'],
    [500, 'retryable', 'provider_unavailable'],
    [503, 'retryable', 'provider_unavailable'],
  ])('normalizes status %i without exposing response data', async (status, kind, code) => {
    vi.mocked(fetch).mockResolvedValue(new Response(providerBody, { status }))
    const error = await lawmaticsRequest('/v1/events', { method: 'POST', body: {} }).catch(e => e)
    expect(error).toMatchObject({ provider: 'lawmatics', kind, code, retryAfterMs: null })
    expectSafe(error)
  })

  it('reports the fields a 422 names, keeping Lawmatics wording out of logs and serialization', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ errors: [
      { detail: `${email} is not a valid email`, source: { pointer: '/data/attributes/email' } },
    ] }), { status: 422 }))
    const error = await lawmaticsRequest('/v1/prospects', { method: 'POST', body: {} }).catch(e => e) as LawmaticsValidationError
    expect(error).toBeInstanceOf(LawmaticsValidationError)
    expect(error).toMatchObject({ kind: 'attention', code: 'validation_failed', fields: ['email'] })
    expect(error.safeMessage).toBe('Lawmatics rejected these fields: email.')
    expect(error.details).toEqual([`${email} is not a valid email`])
    expectSafe(error)
  })

  it('normalizes network failures without preserving unsafe causes', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error(providerBody))
    const error = await lawmaticsRequest('/v1/events', { method: 'GET' }).catch(e => e)
    expect(error).toMatchObject({ kind: 'retryable', code: 'network_error' })
    expectSafe(error)
  })

  it('aborts a stalled request and releases its timer', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    vi.mocked(fetch).mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      signal = init?.signal ?? undefined
      signal?.addEventListener('abort', () => reject(new Error(providerBody)))
    }))
    const pending = lawmaticsRequest('/v1/events', { method: 'GET' }).catch(e => e)
    await vi.advanceTimersByTimeAsync(30_000)
    const error = await pending
    expect(signal?.aborted).toBe(true)
    expect(error).toMatchObject({ kind: 'retryable', code: 'timeout' })
    expectSafe(error)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([providerBody, '{"unexpected":true}'])('normalizes malformed successful responses', async body => {
    vi.mocked(fetch).mockResolvedValue(new Response(body, { status: 200 }))
    const error = await lawmaticsRequest('/v1/events', { method: 'GET' }).catch(e => e)
    expect(error).toMatchObject({ kind: 'retryable', code: 'invalid_response' })
    expectSafe(error)
  })

  it('normalizes a missing connection before making a request', async () => {
    vi.mocked(getLawmaticsAccessToken).mockRejectedValue(new Error('Lawmatics is not connected'))
    await expect(lawmaticsRequest('/v1/events', { method: 'GET' }))
      .rejects.toMatchObject({ kind: 'attention', code: 'authentication_required' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('normalizes token-store failures without exposing their cause', async () => {
    vi.mocked(getLawmaticsAccessToken).mockRejectedValue(new Error(providerBody))
    const error = await lawmaticsRequest('/v1/events', { method: 'GET' }).catch(e => e)
    expect(error).toMatchObject({ kind: 'retryable', code: 'connection_unavailable' })
    expectSafe(error)
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['https://other.example/v1/events', '//other.example/v1/events'])('rejects non-API paths: %s', async path => {
    await expect(lawmaticsRequest(path, { method: 'GET' }))
      .rejects.toMatchObject({ kind: 'attention', code: 'invalid_request' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('accepts empty 204 responses', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }))
    await expect(lawmaticsRequest('/v1/events/25', { method: 'DELETE' })).resolves.toBeUndefined()
  })
})
