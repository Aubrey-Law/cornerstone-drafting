import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  isMercuryConfigured: vi.fn(),
  loadMercuryDepositProposals: vi.fn(),
}))

vi.mock('@/lib/apiAuth', () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock('@/lib/integrations/mercury/deposits', () => ({
  isMercuryConfigured: mocks.isMercuryConfigured,
  loadMercuryDepositProposals: mocks.loadMercuryDepositProposals,
}))

import { GET } from '@/app/api/admin/billing/mercury/deposits/route'
import { IntegrationError } from '@/lib/integrations/errors'

const USER_ID = '00000000-0000-4000-8000-000000000001'

function request(query = '') {
  return new Request(`http://app.test/api/admin/billing/mercury/deposits${query}`)
}

const view = {
  generatedAt: '2026-09-18T14:02:11.000Z',
  window: { postedStart: '2026-08-19', postedEnd: '2026-09-18' },
  summary: { scanned: 1, ignored: 0, proposed: 1, ambiguous: 0, unmatched: 0, alreadyApplied: 0 },
  proposals: [{
    deposit: {
      transactionId: 't1', accountId: 'a1', amountCents: 72_500, postedAt: '2026-08-20T12:00:00Z',
      counterpartyName: 'Lara Coakley', bankDescription: null, kind: 'externalTransfer', status: 'sent',
    },
    status: 'proposed',
    ignoreReason: null,
    candidates: [],
  }],
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAdmin.mockResolvedValue({ err: null, userId: USER_ID, user: { id: USER_ID } })
  mocks.isMercuryConfigured.mockReturnValue(true)
  mocks.loadMercuryDepositProposals.mockResolvedValue(view)
})

describe('GET mercury deposits', () => {
  it('rejects an unauthenticated read before touching Mercury', async () => {
    mocks.requireAdmin.mockResolvedValue({
      err: Response.json({ error: 'Unauthorized' }, { status: 401 }), userId: null, user: null,
    })

    expect((await GET(request())).status).toBe(401)
    expect(mocks.loadMercuryDepositProposals).not.toHaveBeenCalled()
  })

  /** An unset token is a switched-off feature, not a fault. */
  it('reports an unconfigured integration as unavailable', async () => {
    mocks.isMercuryConfigured.mockReturnValue(false)

    const response = await GET(request())
    expect(response.status).toBe(503)
    expect(mocks.loadMercuryDepositProposals).not.toHaveBeenCalled()
  })

  it.each(['?days=0', '?days=999', '?limit=0', '?limit=5000', '?days=abc'])('rejects %s', async query => {
    expect((await GET(request(query))).status).toBe(400)
    expect(mocks.loadMercuryDepositProposals).not.toHaveBeenCalled()
  })

  it('applies defaults when no window is given', async () => {
    await GET(request())
    expect(mocks.loadMercuryDepositProposals).toHaveBeenCalledWith({ days: 30, limit: 100 })
  })

  /**
   * The card needs a payer, an amount and a date. Everything else Mercury
   * returns about an account or a card stays on the server.
   */
  it('returns only what the card renders', async () => {
    const body = await (await GET(request())).text()

    for (const leaked of ['trackingNumber', 'cardId', 'categoryData', 'mercuryCategory', 'routingNumber', 'accountNumber', 'availableBalance']) {
      expect(body).not.toContain(leaked)
    }
    expect(JSON.parse(body).proposals[0].deposit.amountCents).toBe(72_500)
  })

  it('passes a rate limit through with its Retry-After intact', async () => {
    mocks.loadMercuryDepositProposals.mockRejectedValue(new IntegrationError({
      provider: 'mercury', kind: 'retryable', code: 'rate_limited',
      safeMessage: 'Mercury rate limit reached. Try again later.', retryAfterMs: 30_000,
    }))

    const response = await GET(request())
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('30')
  })

  it.each([
    ['retryable', 'provider_unavailable', 503],
    ['attention', 'authentication_required', 502],
  ] as const)('maps a %s failure to %i', async (kind, code, status) => {
    mocks.loadMercuryDepositProposals.mockRejectedValue(new IntegrationError({
      provider: 'mercury', kind, code, safeMessage: 'Mercury is unavailable.', retryAfterMs: null,
    }))

    expect((await GET(request())).status).toBe(status)
  })

  it('does not leak an unexpected error to the caller', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.loadMercuryDepositProposals.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:5432'))

    const response = await GET(request())
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('ECONNREFUSED')
    log.mockRestore()
  })
})
