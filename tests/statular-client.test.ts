import { inspect } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getStatularConfig, getStatularConfigStatus } from '@/lib/integrations/statular/config'
import { createStatularClient, createStatularMatter } from '@/lib/integrations/statular/client'
import type { StatularClientPayload, StatularMatterPayload } from '@/lib/integrations/statular/types'
import { IntegrationError } from '@/lib/integrations/errors'

const clientUrl = 'https://api.statular.com/webhooks/v1/stat_whk_privateClient'
const matterUrl = 'https://api.statular.com/webhooks/v1/stat_whk_privateMatter'
const privateBody = `private-client@example.com ${clientUrl} ${matterUrl}`
const client = { first_name: 'Jane', last_name: 'Doe' }
const matter = { client_id: 12345, doc_id: 4, state: 'MA' }
const key = 'cornerstone:statular:client:lead-1:v1'

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('STATULAR_CLIENT_WEBHOOK_URL', clientUrl)
  vi.stubEnv('STATULAR_MATTER_WEBHOOK_URL', matterUrl)
  vi.stubEnv('STATULAR_WEBHOOK_GENERATION', 'v1')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ id: 12345 }, { status: 201 })))
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, method).mockImplementation(() => {})
  }
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

function expectSafe(error: unknown) {
  expect(error).toBeInstanceOf(IntegrationError)
  expect(error).not.toHaveProperty('cause')
  const output = inspect(error) + JSON.stringify(error) + inspect([
    vi.mocked(console.log).mock.calls, vi.mocked(console.info).mock.calls,
    vi.mocked(console.warn).mock.calls, vi.mocked(console.error).mock.calls,
    vi.mocked(console.debug).mock.calls,
  ])
  for (const secret of [clientUrl, matterUrl, 'stat_whk_', 'private-client@example.com']) {
    expect(output).not.toContain(secret)
  }
}

describe('Statular configuration', () => {
  it('keeps credentials in server config and exposes only boolean readiness', () => {
    expect(getStatularConfig()).toEqual({ clientWebhookUrl: clientUrl, matterWebhookUrl: matterUrl, generation: 'v1' })
    expect(getStatularConfigStatus()).toEqual({ clientConfigured: true, matterConfigured: true, generationConfigured: true })
  })

  it.each(['STATULAR_CLIENT_WEBHOOK_URL', 'STATULAR_MATTER_WEBHOOK_URL', 'STATULAR_WEBHOOK_GENERATION'])('blocks requests when %s is missing or blank', async variable => {
    vi.stubEnv(variable, '   ')
    const error = await createStatularClient(client, key).catch(e => e)
    expect(error).toMatchObject({ provider: 'statular', kind: 'attention', code: 'configuration_required' })
    expectSafe(error)
    expect(fetch).not.toHaveBeenCalled()
    expect(Object.values(getStatularConfigStatus()).filter(Boolean)).toHaveLength(2)
  })

  it.each([
    'http://api.statular.com/webhooks/v1/stat_whk_privateClient',
    'https://api.statular.com.evil.example/stat_whk_privateClient',
    'https://user:stat_whk_privateClient@api.statular.com/webhooks/v1/token',
    'https://api.statular.com:8443/webhooks/v1/stat_whk_privateClient',
    'not-a-url-stat_whk_privateClient',
  ])('rejects unsafe production webhook configuration without disclosing it', async url => {
    vi.stubEnv('STATULAR_CLIENT_WEBHOOK_URL', url)
    const error = await createStatularClient(client, key).catch(e => e)
    expect(error).toMatchObject({ kind: 'attention', code: 'configuration_required' })
    expectSafe(error)
    expect(fetch).not.toHaveBeenCalled()
    expect(getStatularConfigStatus()).toEqual({ clientConfigured: false, matterConfigured: true, generationConfigured: true })
  })

  it('allows an HTTPS test host outside production', () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('STATULAR_CLIENT_WEBHOOK_URL', 'https://statular.test/webhook')
    expect(getStatularConfig().clientWebhookUrl).toBe('https://statular.test/webhook')
  })
})

describe('Statular allow-listed payloads', () => {
  it('transmits the complete documented client shape without adding fields', async () => {
    await createStatularClient({
      ...client, middle_name: 'Marie', email: 'jane@example.com', phone: '+16175550100',
      dob: '1980-01-02', gender: 'female', marital_status: 'married', partner: true,
      address: { streetAddress1: '1 Main St', streetAddress2: 'Apt 2', city: 'Boston', county: 'Suffolk', state: 'MA', zip: '02110' },
      partner_first_name: 'John', partner_middle_name: 'James', partner_last_name: 'Doe',
      partner_email: 'john@example.com', partner_phone: '+16175550101', partner_dob: '1981-03-04', partner_gender: 'male',
      partner_address: { city: 'Boston' }, notes: 'Intake notes',
      children: [{ name: 'Sam Doe', relationship: 'joint', gender: 'nonbinary', birthdate: '2010-01-02', phone: '5550100', email: 'sam@example.com', address: { city: 'Boston' }, deceased: false }],
    }, key)
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe(clientUrl)
    expect(init).toMatchObject({ method: 'POST', cache: 'no-store', redirect: 'error', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key } })
    expect(JSON.parse(init?.body as string)).toEqual({
      first_name: 'Jane', last_name: 'Doe', middle_name: 'Marie', email: 'jane@example.com', phone: '+16175550100',
      dob: '1980-01-02', gender: 'female', marital_status: 'married', partner: true,
      address: { streetAddress1: '1 Main St', streetAddress2: 'Apt 2', city: 'Boston', county: 'Suffolk', state: 'MA', zip: '02110' },
      partner_first_name: 'John', partner_middle_name: 'James', partner_last_name: 'Doe', partner_email: 'john@example.com', partner_phone: '+16175550101', partner_dob: '1981-03-04', partner_gender: 'male',
      partner_address: { city: 'Boston' }, notes: 'Intake notes',
      children: [{ name: 'Sam Doe', relationship: 'joint', gender: 'nonbinary', birthdate: '2010-01-02', phone: '5550100', email: 'sam@example.com', address: { city: 'Boston' }, deceased: false }],
    })
  })

  it('uses the separate matter webhook and exact matter fields', async () => {
    await createStatularMatter({ ...matter, matter_name: 'Doe Family Trust', drafter_id: '99' }, 'matter-key')
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe(matterUrl)
    expect(JSON.parse(init?.body as string)).toEqual({ client_id: 12345, doc_id: 4, state: 'MA', matter_name: 'Doe Family Trust', drafter_id: '99' })
  })

  it.each([
    { ...client, extra: privateBody }, { first_name: 'Jane' }, { ...client, last_name: ' ' },
    { ...client, middle_name: 2 }, { ...client, email: 'invalid' }, { ...client, partner_email: 'invalid' },
    { ...client, gender: 'unknown' }, { ...client, partner_gender: 'unknown' }, { ...client, partner: 'yes' },
    { ...client, address: { street_address: privateBody } }, { ...client, address: [] },
    { ...client, partner_address: { zip: 2110 } }, { ...client, children: {} },
    { ...client, children: [{ name: 'Sam' }] }, { ...client, children: [{ relationship: 'joint' }] },
    { ...client, children: [{ name: 'Sam', relationship: 'other' }] },
    { ...client, children: [{ name: 'Sam', relationship: 'joint', secret: privateBody }] },
    { ...client, children: [{ name: 'Sam', relationship: 'settlor1', gender: 'unknown' }] },
    { ...client, children: [{ name: 'Sam', relationship: 'settlor2', deceased: 'no' }] },
    { ...client, children: [{ name: 'Sam', relationship: 'joint', address: { secret: privateBody } }] },
    { ...client, children: [{ name: 'Sam', relationship: 'joint', email: 'invalid' }] },
    null, [],
  ])('rejects invalid client fields before fetch', async payload => {
    const error = await createStatularClient(payload as unknown as StatularClientPayload, key).catch(e => e)
    expect(error).toMatchObject({ kind: 'attention', code: 'invalid_payload' })
    expectSafe(error)
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    { client_id: 1 }, { doc_id: 1 }, { ...matter, client_id: 0 }, { ...matter, doc_id: -1 },
    { ...matter, drafter_id: '' }, { ...matter, doc_id: 1.5 }, { ...matter, client_id: 'abc' },
    { ...matter, state: 'Massachusetts' }, { ...matter, state: 'ma' }, { ...matter, matter_name: 123 },
    { ...matter, unknown: privateBody },
  ])('rejects invalid matter fields before fetch', async payload => {
    const error = await createStatularMatter(payload as unknown as StatularMatterPayload, key).catch(e => e)
    expect(error).toMatchObject({ kind: 'attention', code: 'invalid_payload' })
    expectSafe(error)
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['', ' ', 'a'.repeat(201), 'key\r\nInjected: value'])('rejects invalid idempotency keys before fetch', async invalidKey => {
    await expect(createStatularClient(client, invalidKey)).rejects.toMatchObject({ kind: 'attention', code: 'invalid_idempotency_key' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('accepts the 200 character idempotency-key boundary', async () => {
    await expect(createStatularClient(client, 'a'.repeat(200))).resolves.toEqual({ id: '12345' })
  })
})

describe('Statular transport', () => {
  it.each([12345, '12345'])('returns only the positive ID from create and replay', async id => {
    vi.mocked(fetch).mockImplementation(async () => Response.json({ id, secret: privateBody }, { status: 201 }))
    await expect(createStatularClient(client, key)).resolves.toEqual({ id: '12345' })
    await expect(createStatularClient(client, key)).resolves.toEqual({ id: '12345' })
  })

  it('accepts a successful 200 replay response', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ id: '12345' }, { status: 200 }))
    await expect(createStatularClient(client, key)).resolves.toEqual({ id: '12345' })
  })

  it.each([0, -1, '', '0', '-1', '1.5', 'abc', null, {}, true, 1.5])('rejects unusable identities safely', async id => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ id, message: privateBody }, { status: 201 }))
    const error = await createStatularClient(client, key).catch(e => e)
    expect(error).toMatchObject({ kind: 'attention', code: 'invalid_response' })
    expectSafe(error)
  })

  it.each([privateBody, '{}', 'null'])('redacts malformed success responses', async body => {
    vi.mocked(fetch).mockResolvedValue(new Response(body, { status: 201 }))
    const error = await createStatularClient(client, key).catch(e => e)
    expect(error).toMatchObject({ kind: 'attention', code: 'invalid_response' })
    expectSafe(error)
  })

  it.each([[401, 'attention', 'authentication_required'], [403, 'attention', 'permission_denied'], [422, 'attention', 'validation_failed'], [500, 'retryable', 'provider_unavailable'], [503, 'retryable', 'provider_unavailable'], [400, 'attention', 'request_rejected']])('normalizes HTTP %i safely', async (status, kind, code) => {
    const response = new Response(privateBody, { status: Number(status) })
    const read = vi.spyOn(response, 'json')
    vi.mocked(fetch).mockResolvedValue(response)
    const error = await createStatularClient(client, key).catch(e => e)
    expect(error).toMatchObject({ provider: 'statular', kind, code, retryAfterMs: null })
    expectSafe(error)
    expect(read).not.toHaveBeenCalled()
  })

  it.each(['in progress', 'different payload'])('treats opaque 409 as retryable; durable claims must reject hash conflicts before transport (%s)', async message => {
    vi.mocked(fetch).mockResolvedValue(new Response(`${message} ${privateBody}`, { status: 409 }))
    const error = await createStatularClient(client, key).catch(e => e)
    expect(error).toMatchObject({ kind: 'retryable', code: 'idempotency_conflict' })
    expect(error.retryAfterMs).toBeGreaterThan(0)
    expect(error.retryAfterMs).toBeLessThanOrEqual(5000)
    expectSafe(error)
  })

  it.each([['7', 7000], ['Wed, 16 Sep 2026 14:00:09 GMT', 9000], ['Wed, 16 Sep 2026 13:59:00 GMT', 0], ['invalid', null], ['-7', null], [null, null]])('preserves safe Retry-After %s', async (retryAfter, retryAfterMs) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-16T14:00:00Z'))
    vi.mocked(fetch).mockResolvedValue(new Response(privateBody, { status: 429, headers: retryAfter === null ? {} : { 'Retry-After': String(retryAfter) } }))
    const error = await createStatularClient(client, key).catch(e => e)
    expect(error).toMatchObject({ kind: 'retryable', code: 'rate_limited', retryAfterMs })
    expectSafe(error)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('drops unsafe transport causes', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error(privateBody))
    const error = await createStatularClient(client, key).catch(e => e)
    expect(error).toMatchObject({ kind: 'retryable', code: 'network_error' })
    expectSafe(error)
  })

  it.each(['timeout', 'external'] as const)('cancels in-flight fetch on %s and cleans listeners/timers', async mode => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    let transportSignal: AbortSignal | null | undefined
    vi.mocked(fetch).mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      transportSignal = init?.signal
      transportSignal?.addEventListener('abort', () => reject(new Error(privateBody)))
    }))
    const pending = createStatularClient(client, key, controller.signal).catch(e => e)
    if (mode === 'timeout') await vi.advanceTimersByTimeAsync(30_000)
    else controller.abort(new Error(privateBody))
    const error = await pending
    expect(error).toMatchObject({ kind: 'retryable', code: 'timeout' })
    expect(transportSignal?.aborted).toBe(true)
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
    expectSafe(error)
  })

  it('does not send when already cancelled', async () => {
    const signal = AbortSignal.abort(new Error(privateBody))
    await expect(createStatularMatter(matter, key, signal)).rejects.toMatchObject({ kind: 'retryable', code: 'timeout' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects cancellation during response parsing and cleans up after success', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const response = Response.json({ id: 12345 }, { status: 201 })
    vi.spyOn(response, 'json').mockImplementation(async () => {
      controller.abort(new Error(privateBody))
      return { id: 12345 }
    })
    vi.mocked(fetch).mockResolvedValue(response)
    const error = await createStatularClient(client, key, controller.signal).catch(e => e)
    expect(error).toMatchObject({ kind: 'retryable', code: 'timeout' })
    expectSafe(error)
    expect(vi.getTimerCount()).toBe(0)
    vi.mocked(fetch).mockResolvedValue(Response.json({ id: 12345 }, { status: 201 }))
    const fresh = new AbortController()
    const remove = vi.spyOn(fresh.signal, 'removeEventListener')
    await createStatularClient(client, key, fresh.signal)
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
  })
})
