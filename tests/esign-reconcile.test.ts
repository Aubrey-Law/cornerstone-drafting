import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_BATCH_LIMIT, DEFAULT_STALE_MINUTES, reconcileAgreement } from '@/lib/esign/reconcile'
import type { EsignEnvelopeState, EsignProvider } from '@/lib/esign/types'

/**
 * Reconciliation exists because webhooks get dropped. These tests pin the two
 * properties that make it safe to run unattended: it never notifies anyone,
 * and it only writes on an authoritative answer.
 */

const completion = vi.hoisted(() => ({
  applyRecipientStates: vi.fn(async () => {}),
  completeWorkspaceAgreement: vi.fn(async () => ({ ok: true as const, r2Key: 'k' })),
}))

vi.mock('@/lib/esign/completion', () => completion)
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => admin }))
vi.mock('@/lib/esign/firma', () => ({ resolveEsignProvider: () => ({ ok: true, provider }) }))

const updates: Array<{ table: string; values: Record<string, unknown> }> = []

const admin = {
  from: vi.fn((table: string) => {
    const chain: Record<string, unknown> = {}
    chain.select = vi.fn(() => chain)
    chain.eq = vi.fn(() => chain)
    chain.neq = vi.fn(() => chain)
    chain.in = vi.fn(() => chain)
    chain.update = vi.fn((values: Record<string, unknown>) => {
      updates.push({ table, values })
      return chain
    })
    chain.single = vi.fn(async () => ({ data: null, error: null }))
    chain.maybeSingle = vi.fn(async () => ({ data: null, error: null }))
    return chain
  }),
} as never

let state: EsignEnvelopeState
const provider = {
  name: 'firma',
  capabilities: { resend: true, cancel: true, embeddedSigning: false, separateAuditCertificate: false },
  getEnvelopeState: vi.fn(async () => state),
} as unknown as EsignProvider

const agreement = {
  id: 'agreement-1',
  matter_id: 'matter-1',
  status: 'sent',
  provider: 'firma',
  external_request_id: 'req-1',
  firma_request_id: null,
}

beforeEach(() => {
  updates.length = 0
  vi.clearAllMocks()
  completion.completeWorkspaceAgreement.mockResolvedValue({ ok: true as const, r2Key: 'k' })
  state = { status: 'sent', signedAt: null, artifacts: [], recipients: [] }
})

describe('reconcileAgreement', () => {
  it('records that the provider was reached, even when nothing changed', async () => {
    const result = await reconcileAgreement(admin, provider, agreement)

    expect(result).toEqual({ changed: false, completed: false, failed: false })
    expect(updates).toContainEqual(expect.objectContaining({
      table: 'engagement_agreements',
      values: expect.objectContaining({ provider_sync_error: null }),
    }))
  })

  it('advances a status the webhook never delivered', async () => {
    state = { status: 'viewed', signedAt: null, artifacts: [], recipients: [] }

    const result = await reconcileAgreement(admin, provider, agreement)

    expect(result.changed).toBe(true)
    expect(updates).toContainEqual(expect.objectContaining({
      table: 'engagement_agreements',
      values: expect.objectContaining({ status: 'viewed' }),
    }))
  })

  it('completes a signing the webhook missed, through the shared completion path', async () => {
    state = { status: 'signed', signedAt: '2026-01-01T00:00:00Z', artifacts: [], recipients: [] }

    const result = await reconcileAgreement(admin, provider, agreement)

    expect(result.completed).toBe(true)
    // Completion is not reimplemented here — that is the whole point of the
    // shared module.
    expect(completion.completeWorkspaceAgreement).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({ agreementId: 'agreement-1', matterId: 'matter-1' }),
    )
  })

  it('records a sync error and writes no state when the provider is unreachable', async () => {
    vi.mocked(provider.getEnvelopeState).mockRejectedValueOnce(new Error('connect ETIMEDOUT'))

    const result = await reconcileAgreement(admin, provider, agreement)

    expect(result).toEqual({ changed: false, completed: false, failed: true })
    expect(updates).toContainEqual(expect.objectContaining({
      table: 'engagement_agreements',
      values: expect.objectContaining({ provider_sync_error: 'connect ETIMEDOUT' }),
    }))
    // An unreachable provider is not evidence of a status change.
    expect(updates.some(u => 'status' in u.values)).toBe(false)
  })

  it('leaves a retryable deferral unflagged — the next sweep picks it up', async () => {
    state = { status: 'signed', signedAt: null, artifacts: [], recipients: [] }
    completion.completeWorkspaceAgreement.mockResolvedValueOnce({
      ok: false, retryable: true, error: 'signed document not ready yet',
    } as never)

    const result = await reconcileAgreement(admin, provider, agreement)

    expect(result).toEqual({ changed: false, completed: false, failed: false })
    expect(updates.some(u => u.values.provider_sync_error === 'signed document not ready yet')).toBe(false)
  })

  it('skips an agreement that never got a provider request id', async () => {
    const result = await reconcileAgreement(admin, provider, {
      ...agreement, external_request_id: null, firma_request_id: null, status: 'sending',
    })

    expect(result).toEqual({ changed: false, completed: false, failed: false })
    expect(provider.getEnvelopeState).not.toHaveBeenCalled()
  })

  it('falls back to the legacy Firma request id for un-backfilled rows', async () => {
    await reconcileAgreement(admin, provider, {
      ...agreement, external_request_id: null, firma_request_id: 'legacy-req',
    })

    expect(provider.getEnvelopeState).toHaveBeenCalledWith('legacy-req')
  })

  it('never notifies anyone', async () => {
    state = { status: 'sent', signedAt: null, artifacts: [], recipients: [] }
    await reconcileAgreement(admin, provider, agreement)

    // A background sweep that emails clients on its own is how reconciliation
    // turns into an incident.
    expect((provider as unknown as Record<string, unknown>).resendDocumentRequest).toBeUndefined()
    expect(updates.some(u => 'last_reminded_at' in u.values)).toBe(false)
  })
})

describe('reconciliation bounds', () => {
  it('defaults to a bounded batch and a stale window', () => {
    expect(DEFAULT_BATCH_LIMIT).toBeLessThanOrEqual(100)
    expect(DEFAULT_STALE_MINUTES).toBeGreaterThan(0)
  })
})
