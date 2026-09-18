import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IntegrationError } from '@/lib/integrations/errors'

const TOKEN = 'mercury_test_token_do_not_leak'

async function client() {
  return import('@/lib/integrations/mercury/client')
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

function lastRequest(fetchMock: ReturnType<typeof vi.fn>) {
  const [url, init] = fetchMock.mock.calls.at(-1) as [URL | string, RequestInit]
  return { url: new URL(String(url)), init }
}

beforeEach(() => {
  vi.resetModules()
  process.env.MERCURY_API_TOKEN = TOKEN
  process.env.MERCURY_INCOME_ACCOUNT_IDS = '40e1b452-85d1-11f1-92ba-23367ea93847'
  delete process.env.MERCURY_API_BASE_URL
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.MERCURY_API_TOKEN
  delete process.env.MERCURY_INCOME_ACCOUNT_IDS
})

describe('request construction', () => {
  it('sends a bearer token and refuses to cache or follow redirects', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ accounts: [], page: {} }))
    vi.stubGlobal('fetch', fetchMock)

    await (await client()).listMercuryAccounts()

    const { url, init } = lastRequest(fetchMock)
    expect(url.origin).toBe('https://api.mercury.com')
    expect(url.pathname).toBe('/api/v1/accounts')
    expect(new Headers(init.headers).get('Authorization')).toBe(`Bearer ${TOKEN}`)
    expect(init.cache).toBe('no-store')
    expect(init.redirect).toBe('error')
  })

  /**
   * `start`/`end` filter on creation, so a card charge authorized on the 1st and
   * settled on the 3rd falls out of a window that should contain it.
   */
  it('filters transactions on settlement, not creation', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ transactions: [], page: {} }))
    vi.stubGlobal('fetch', fetchMock)

    await (await client()).listMercuryTransactions({ postedStart: '2026-08-01', postedEnd: '2026-09-01' })

    const { url } = lastRequest(fetchMock)
    expect(url.searchParams.get('postedStart')).toBe('2026-08-01')
    expect(url.searchParams.get('postedEnd')).toBe('2026-09-01')
    expect(url.searchParams.has('start')).toBe(false)
    expect(url.searchParams.has('end')).toBe(false)
  })

  it('stops following pages rather than hammering the provider', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      transactions: [], page: { nextPage: 'always-another-page' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await (await client()).listMercuryTransactions({ postedStart: '2026-08-01', postedEnd: '2026-09-01' })

    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(5)
  })

  it('converts dollar amounts to cents at the boundary', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      transactions: [{
        id: 't1', accountId: 'a1', amount: -12.48, postedAt: '2026-08-27T00:04:50Z',
        status: 'sent', kind: 'other', counterpartyName: 'Mercury Credit',
      }],
      page: {},
    })))

    const [transaction] = await (await client()).listMercuryTransactions({ postedStart: '2026-08-01', postedEnd: '2026-09-01' })
    expect(transaction.amountCents).toBe(-1248)
    expect(transaction).not.toHaveProperty('amount')
  })
})

describe('failure classification', () => {
  async function failureFor(status: number, headers: Record<string, string> = {}) {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'nope' }, status, headers)))
    try {
      await (await client()).listMercuryAccounts()
    } catch (error) {
      return error as IntegrationError
    }
    throw new Error(`expected ${status} to throw`)
  }

  it('treats a rate limit as retryable and honours Retry-After', async () => {
    const error = await failureFor(429, { 'Retry-After': '30' })
    expect(error.kind).toBe('retryable')
    expect(error.code).toBe('rate_limited')
    expect(error.retryAfterMs).toBe(30_000)
  })

  it('parses an HTTP-date Retry-After', async () => {
    const when = new Date(Date.now() + 60_000).toUTCString()
    const error = await failureFor(429, { 'Retry-After': when })
    expect(error.retryAfterMs).toBeGreaterThan(0)
  })

  it('treats provider outages as retryable', async () => {
    expect((await failureFor(503)).kind).toBe('retryable')
  })

  it.each([
    [401, 'authentication_required'],
    [403, 'permission_denied'],
    [404, 'not_found'],
    [422, 'validation_failed'],
  ])('routes %i to a person, not a retry', async (status, code) => {
    const error = await failureFor(status)
    expect(error.kind).toBe('attention')
    expect(error.code).toBe(code)
  })

  it('reports an unusable body shape rather than trusting it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ accounts: 'not-an-array' })))
    await expect((await client()).listMercuryAccounts()).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('surfaces an aborted request as a timeout', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('aborted', 'AbortError') }))
    const controller = new AbortController()
    controller.abort()
    await expect((await client()).listMercuryAccounts(controller.signal))
      .rejects.toMatchObject({ kind: 'retryable', code: 'timeout' })
  })

  /**
   * Provider error bodies can echo the credential back and carry customer
   * detail, so nothing from one may reach a log line or an API response.
   */
  it('never lets a provider error body or the token escape', async () => {
    const sentinel = 'PROVIDER_BODY_SENTINEL_client@example.com'
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: sentinel, token: TOKEN }, 422)))

    let error: IntegrationError | null = null
    try {
      await (await client()).listMercuryAccounts()
    } catch (caught) {
      error = caught as IntegrationError
    }

    const serialized = `${error?.message} ${error?.safeMessage} ${error?.stack} ${JSON.stringify(error)}`
    expect(serialized).not.toContain(sentinel)
    expect(serialized).not.toContain(TOKEN)
  })
})

describe('configuration', () => {
  it('refuses to call Mercury without a token', async () => {
    delete process.env.MERCURY_API_TOKEN
    vi.resetModules()
    await expect((await client()).listMercuryAccounts())
      .rejects.toMatchObject({ code: 'configuration_required' })
  })

  it('rejects a base URL pointing somewhere other than Mercury', async () => {
    process.env.MERCURY_API_BASE_URL = 'https://attacker.example.com/api/v1'
    vi.resetModules()
    await expect((await client()).listMercuryAccounts())
      .rejects.toMatchObject({ code: 'configuration_required' })
  })

  it('accepts the sandbox host', async () => {
    process.env.MERCURY_API_BASE_URL = 'https://api-sandbox.mercury.com/api/v1'
    vi.resetModules()
    const fetchMock = vi.fn(async () => jsonResponse({ accounts: [], page: {} }))
    vi.stubGlobal('fetch', fetchMock)

    await (await client()).listMercuryAccounts()
    expect(lastRequest(fetchMock).url.origin).toBe('https://api-sandbox.mercury.com')
  })
})
