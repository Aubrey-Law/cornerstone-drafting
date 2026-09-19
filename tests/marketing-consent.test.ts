import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  consumeRateLimit: vi.fn(),
  sendEmail: vi.fn(),
  from: vi.fn(),
}))
vi.mock('@/lib/rateLimit', () => ({ consumeRateLimit: mocks.consumeRateLimit }))
vi.mock('@/lib/email/send', () => ({ sendEmail: mocks.sendEmail }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({ from: mocks.from }) }))

import {
  createConsentToken,
  normalizeConsentSource,
  normalizeEmail,
  readConsentToken,
} from '@/lib/marketing/consentTokens'
import { recordConfirmedConsent } from '@/lib/marketing/consent'
import { POST as subscribe } from '@/app/api/marketing/subscribe/route'
import { POST as confirm } from '@/app/api/marketing/confirm/route'

const NOW = 1_770_000_000_000
const allowed = { ok: true, count: 1, limit: 5, retryAfterSeconds: 0 }
const blocked = { ok: false, count: 99, limit: 5, retryAfterSeconds: 1800 }

describe('normalizeEmail', () => {
  it('lowercases and trims so mint and verify agree', () => {
    expect(normalizeEmail('  Scott@Example.COM ')).toBe('scott@example.com')
  })

  it('rejects what is not plausibly an address', () => {
    for (const bad of ['', '   ', 'no-at-sign', 'a@b', 'two@@at.com', 'spa ce@x.com', null, 42]) {
      expect(normalizeEmail(bad)).toBeNull()
    }
    expect(normalizeEmail(`${'a'.repeat(250)}@example.com`)).toBeNull()
  })
})

describe('consent tokens', () => {
  it('round-trips the address and the source', () => {
    const token = createConsentToken('Scott@Example.com', 'Footer Form!', NOW)
    const read = readConsentToken(token, { nowMs: NOW })
    expect(read).toEqual({ ok: true, email: 'scott@example.com', issuedAt: NOW / 1000, source: 'footer-form-' })
  })

  it('rejects a token whose payload was edited', () => {
    const token = createConsentToken('scott@example.com', 'website-optin', NOW)
    const [prefix, , signature] = token.split('.')
    const forged = Buffer.from(
      JSON.stringify({ e: 'attacker@evil.com', t: NOW / 1000, s: 'website-optin' }),
    ).toString('base64url')

    const read = readConsentToken(`${prefix}.${forged}.${signature}`, { nowMs: NOW })
    expect(read).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('separates an expired link from an invalid one so the page can say which', () => {
    const token = createConsentToken('scott@example.com', 'website-optin', NOW)
    const eightDays = NOW + 8 * 24 * 60 * 60 * 1000
    expect(readConsentToken(token, { nowMs: eightDays })).toEqual({ ok: false, reason: 'expired' })
    expect(readConsentToken('mc1.garbage.sig', { nowMs: NOW }).ok).toBe(false)
    expect(readConsentToken(undefined)).toEqual({ ok: false, reason: 'malformed' })
  })

  it('rejects a token issued in the future rather than trusting the clock', () => {
    const token = createConsentToken('scott@example.com', 'website-optin', NOW + 3_600_000)
    expect(readConsentToken(token, { nowMs: NOW })).toEqual({ ok: false, reason: 'expired' })
  })

  it('falls back to a default source rather than storing junk', () => {
    expect(normalizeConsentSource('  ')).toBe('website-optin')
    expect(normalizeConsentSource(null)).toBe('website-optin')
    expect(normalizeConsentSource('Event — Fall 2026')).toBe('event---fall-2026')
  })
})

/** Chainable stand-in for the single update the consent write performs. */
function crmUpdate(rows: Array<{ id: string }> | null, error: { message: string } | null = null) {
  const chain = {
    eq: vi.fn(() => chain),
    select: vi.fn(() => Promise.resolve({ data: rows, error })),
  }
  const update = vi.fn(() => chain)
  mocks.from.mockReturnValue({ update })
  return { update, chain }
}

describe('recordConfirmedConsent', () => {
  beforeEach(() => vi.clearAllMocks())

  it('stamps every row for the address and clears a prior opt-out', async () => {
    const { update, chain } = crmUpdate([{ id: 'p1' }, { id: 'p2' }])
    const result = await recordConfirmedConsent('Scott@Example.com', 'website-optin', new Date(NOW))

    expect(result).toEqual({ matched: 2 })
    expect(update).toHaveBeenCalledWith({
      marketing_consent_status: 'subscribed',
      consent_source: 'website-optin',
      consent_captured_at: new Date(NOW).toISOString(),
      unsubscribed_at: null,
    })
    expect(chain.eq).toHaveBeenCalledWith('normalized_email', 'scott@example.com')
  })

  it('treats an unknown address as a normal outcome, not a failure', async () => {
    crmUpdate([])
    await expect(recordConfirmedConsent('stranger@example.com', 'website-optin')).resolves.toEqual({ matched: 0 })
  })

  it('throws when the write itself fails, rather than reporting consent it did not record', async () => {
    crmUpdate(null, { message: 'permission denied' })
    await expect(recordConfirmedConsent('scott@example.com', 'website-optin')).rejects.toThrow('permission denied')
  })
})

function request(body: unknown) {
  return new Request('http://app.test/api/marketing/subscribe', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'x-forwarded-for': '203.0.113.7' },
  })
}

describe('POST /api/marketing/subscribe', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.TURNSTILE_SECRET_KEY
    mocks.consumeRateLimit.mockResolvedValue(allowed)
    // No message-id field: the route only reads `ok`, and naming one would tie
    // this test to whichever of resendId/providerMessageId the branch has.
    mocks.sendEmail.mockResolvedValue({ ok: true, status: 'sent', logId: 'l' })
  })

  it('records nothing — consent waits for the emailed link', async () => {
    const res = await subscribe(request({ email: 'scott@example.com' }))
    expect(res.status).toBe(200)
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1)
    // The database is never touched on this path. If it ever is, consent is
    // being created by typing an address, which is the thing double opt-in exists
    // to prevent.
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('sends a confirmation carrying a token that verifies back to the address', async () => {
    await subscribe(request({ email: 'Scott@Example.com', source: 'footer' }))

    const [[args]] = mocks.sendEmail.mock.calls
    expect(args.category).toBe('marketing_optin_confirm')
    expect(args.to).toBe('scott@example.com')

    const token = decodeURIComponent(/token=([^"&]+)/.exec(args.html as string)![1])
    expect(readConsentToken(token)).toMatchObject({ ok: true, email: 'scott@example.com', source: 'footer' })
  })

  it('400s an invalid address before sending anything', async () => {
    const res = await subscribe(request({ email: 'not-an-address' }))
    expect(res.status).toBe(400)
    expect(mocks.sendEmail).not.toHaveBeenCalled()
  })

  it('429s a single caller spraying addresses', async () => {
    mocks.consumeRateLimit.mockResolvedValueOnce(blocked)
    const res = await subscribe(request({ email: 'scott@example.com' }))

    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('1800')
    expect(mocks.sendEmail).not.toHaveBeenCalled()
  })

  it('silently stops mailing an address under attack, without saying so', async () => {
    // Per-IP allowed, per-address blocked: the person typing is not the person
    // being mailed, so the reply must not confirm that the address is a target.
    mocks.consumeRateLimit
      .mockResolvedValueOnce(allowed)
      .mockResolvedValueOnce(blocked)

    const res = await subscribe(request({ email: 'victim@example.com' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      message: 'Check your email for a link to confirm your subscription.',
    })
    expect(mocks.sendEmail).not.toHaveBeenCalled()
  })

  it('answers identically for a known and an unknown address', async () => {
    const a = await subscribe(request({ email: 'client@example.com' }))
    const b = await subscribe(request({ email: 'stranger@example.com' }))
    expect(await a.json()).toEqual(await b.json())
  })

  it('rejects a failed Turnstile challenge in production configuration', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret'
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: false }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await subscribe(request({ email: 'scott@example.com', turnstileToken: 'bad' }))
    expect(res.status).toBe(400)
    expect(mocks.sendEmail).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

function confirmRequest(token: unknown) {
  return new Request('http://app.test/api/marketing/confirm', {
    method: 'POST',
    body: JSON.stringify({ token }),
  })
}

describe('POST /api/marketing/confirm', () => {
  beforeEach(() => vi.clearAllMocks())

  it('records consent for a valid token and reports what it stamped', async () => {
    const { update } = crmUpdate([{ id: 'p1' }])
    const res = await confirm(confirmRequest(createConsentToken('scott@example.com', 'footer')))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, matched: 1 })
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ marketing_consent_status: 'subscribed', consent_source: 'footer' }),
    )
  })

  it('writes nothing for a forged token', async () => {
    crmUpdate([{ id: 'p1' }])
    const real = createConsentToken('scott@example.com', 'website-optin')
    const [prefix, , signature] = real.split('.')
    const forged = Buffer.from(
      JSON.stringify({ e: 'attacker@evil.com', t: Math.floor(Date.now() / 1000), s: 'website-optin' }),
    ).toString('base64url')

    const res = await confirm(confirmRequest(`${prefix}.${forged}.${signature}`))

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ ok: false, reason: 'invalid' })
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('distinguishes an aged-out link (410) from an invalid one (400)', async () => {
    crmUpdate([])
    const old = createConsentToken('scott@example.com', 'website-optin', NOW)
    const stale = await confirm(confirmRequest(old))
    expect(stale.status).toBe(410)
    expect(await stale.json()).toEqual({ ok: false, reason: 'expired' })

    const junk = await confirm(confirmRequest('not-a-token'))
    expect(junk.status).toBe(400)
    expect(await junk.json()).toEqual({ ok: false, reason: 'invalid' })
  })

  it('accepts an address the firm has never seen without claiming a row was stamped', async () => {
    crmUpdate([])
    const res = await confirm(confirmRequest(createConsentToken('stranger@example.com')))
    expect(await res.json()).toEqual({ ok: true, matched: 0 })
  })

  it('500s when the write fails rather than telling the person they are subscribed', async () => {
    crmUpdate(null, { message: 'permission denied' })
    const res = await confirm(confirmRequest(createConsentToken('scott@example.com')))

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ ok: false, reason: 'error' })
  })
})
