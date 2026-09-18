import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const TOKEN = 'mercury_secret_token_value'
const INCOME = '40e1b452-85d1-11f1-92ba-23367ea93847'

async function config() {
  return import('@/lib/integrations/mercury/config')
}

beforeEach(() => {
  vi.resetModules()
  delete process.env.MERCURY_API_TOKEN
  delete process.env.MERCURY_API_BASE_URL
  delete process.env.MERCURY_INCOME_ACCOUNT_IDS
})

afterEach(() => {
  delete process.env.MERCURY_API_TOKEN
  delete process.env.MERCURY_API_BASE_URL
  delete process.env.MERCURY_INCOME_ACCOUNT_IDS
})

describe('getMercuryConfigStatus', () => {
  it('reports booleans only, so the token cannot reach a browser', async () => {
    process.env.MERCURY_API_TOKEN = TOKEN
    process.env.MERCURY_INCOME_ACCOUNT_IDS = INCOME
    const status = (await config()).getMercuryConfigStatus()

    expect(status).toEqual({
      tokenConfigured: true, baseUrlValid: true, incomeAccountsConfigured: true, sandbox: false,
    })
    expect(JSON.stringify(status)).not.toContain(TOKEN)
    expect(Object.values(status).every(value => typeof value === 'boolean')).toBe(true)
  })

  it('reports an unconfigured integration rather than throwing', async () => {
    expect((await config()).getMercuryConfigStatus().tokenConfigured).toBe(false)
  })

  it('flags the sandbox so it is never mistaken for production', async () => {
    process.env.MERCURY_API_TOKEN = TOKEN
    process.env.MERCURY_API_BASE_URL = 'https://api-sandbox.mercury.com/api/v1'
    expect((await config()).getMercuryConfigStatus().sandbox).toBe(true)
  })
})

describe('getMercuryConfig', () => {
  it('throws for a person to act on when the token is missing', async () => {
    await expect(async () => (await config()).getMercuryConfig())
      .rejects.toMatchObject({ provider: 'mercury', kind: 'attention', code: 'configuration_required' })
  })

  it.each([
    ['a non-Mercury host', 'https://attacker.example.com/api/v1'],
    ['plain http', 'http://api.mercury.com/api/v1'],
    ['embedded credentials', 'https://user:pass@api.mercury.com/api/v1'],
    ['an explicit port', 'https://api.mercury.com:8443/api/v1'],
    ['a malformed URL', 'not-a-url'],
  ])('rejects %s', async (_label, url) => {
    process.env.MERCURY_API_TOKEN = TOKEN
    process.env.MERCURY_API_BASE_URL = url
    vi.resetModules()
    await expect(async () => (await config()).getMercuryConfig())
      .rejects.toMatchObject({ code: 'configuration_required' })
  })

  it('defaults to the production API when no base URL is set', async () => {
    process.env.MERCURY_API_TOKEN = TOKEN
    expect((await config()).getMercuryConfig().baseUrl).toBe('https://api.mercury.com/api/v1')
  })

  /**
   * Left empty on purpose when unset: every deposit then classifies as
   * `wrong_account` and the card says so, which beats guessing an account and
   * producing a confident, wrong worklist.
   */
  it('yields no income accounts rather than a guess', async () => {
    process.env.MERCURY_API_TOKEN = TOKEN
    expect((await config()).getMercuryConfig().incomeAccountIds).toEqual([])
  })

  it('reads a comma-separated account allowlist', async () => {
    process.env.MERCURY_API_TOKEN = TOKEN
    process.env.MERCURY_INCOME_ACCOUNT_IDS = `${INCOME}, 32c294e2-2b49-11f0-9205-837057363052`
    expect((await config()).getMercuryConfig().incomeAccountIds).toHaveLength(2)
  })

  it('discards the allowlist entirely if any entry is not an account id', async () => {
    process.env.MERCURY_API_TOKEN = TOKEN
    process.env.MERCURY_INCOME_ACCOUNT_IDS = `${INCOME},../../etc/passwd`
    expect((await config()).getMercuryConfig().incomeAccountIds).toEqual([])
  })
})
