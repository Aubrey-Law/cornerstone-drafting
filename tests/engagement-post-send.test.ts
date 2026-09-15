import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cancelEngagementRequest, getEngagementStatus, resendEngagementRecipients } from '@/lib/engagement/postSend'
import type { EsignProvider, EsignProviderCapabilities } from '@/lib/esign/types'

/**
 * Post-send controls act on a live agreement sitting in a client's inbox.
 * These tests pin the guardrails: eligibility is decided on the server, an
 * unsupported operation is refused rather than attempted, and cancelling tells
 * the provider before it tells the database.
 */

let capabilities: EsignProviderCapabilities
let agreementRow: Record<string, unknown>
let recipientRows: Array<Record<string, unknown>>
const calls: string[] = []
const updates: Array<{ table: string; values: Record<string, unknown> }> = []

const provider = {
  name: 'firma',
  get capabilities() { return capabilities },
  resendDocumentRequest: vi.fn(async () => { calls.push('provider.resend') }),
  cancelDocumentRequest: vi.fn(async () => { calls.push('provider.cancel') }),
} as unknown as EsignProvider

const admin = {
  from: vi.fn((table: string) => {
    const chain: Record<string, unknown> = {}
    const rows = table === 'engagement_agreement_recipients'
      ? recipientRows
      : table === 'engagement_esign_artifacts' ? [] : null
    chain.select = vi.fn(() => chain)
    chain.eq = vi.fn(() => chain)
    chain.neq = vi.fn(() => chain)
    chain.in = vi.fn(() => chain)
    chain.order = vi.fn(async () => ({ data: rows, error: null }))
    chain.update = vi.fn((values: Record<string, unknown>) => {
      calls.push(`db.update.${table}`)
      updates.push({ table, values })
      return chain
    })
    chain.single = vi.fn(async () => ({ data: agreementRow, error: null }))
    chain.maybeSingle = vi.fn(async () => ({ data: null, error: null }))
    chain.then = undefined
    return chain
  }),
} as never

vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => admin }))
vi.mock('@/lib/esign/firma', () => ({ resolveEsignProvider: () => ({ ok: true, provider }) }))
vi.mock('@/lib/esign/reconcile', () => ({ reconcileAgreement: vi.fn(async () => ({ changed: false, completed: false, failed: false })) }))
vi.mock('@/lib/r2', () => ({ getR2Client: () => ({}), r2Bucket: () => 'bucket' }))
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: vi.fn(async () => 'https://signed') }))


beforeEach(() => {
  vi.clearAllMocks()
  calls.length = 0
  updates.length = 0
  capabilities = { resend: true, cancel: true, embeddedSigning: false, separateAuditCertificate: false }
  agreementRow = {
    id: 'agreement-1', status: 'sent', provider: 'firma',
    external_request_id: 'req-1', firma_request_id: null, matter_id: 'matter-1',
    sent_at: '2026-01-01T00:00:00Z', completed_at: null,
    last_provider_sync_at: null, provider_sync_error: null, provider_sync_error_at: null,
  }
  recipientRows = [
    { id: 'r1', role: 'primary', name: 'A Client', email: 'a@example.com', recipient_order: 1, status: 'sent', sent_at: '2026-01-01T00:00:00Z', viewed_at: null, signed_at: null, declined_at: null, last_reminded_at: null, external_recipient_id: 'x1', firma_recipient_id: null },
    { id: 'r2', role: 'spouse', name: 'B Client', email: 'b@example.com', recipient_order: 2, status: 'signed', sent_at: '2026-01-01T00:00:00Z', viewed_at: null, signed_at: '2026-01-02T00:00:00Z', declined_at: null, last_reminded_at: null, external_recipient_id: 'x2', firma_recipient_id: null },
  ]
})

describe('engagement status view', () => {
  it('marks only unsigned recipients on a live agreement as resend-eligible', async () => {
    const view = await getEngagementStatus('agreement-1')

    expect(view.recipients.find(r => r.id === 'r1')?.resendEligible).toBe(true)
    expect(view.recipients.find(r => r.id === 'r2')?.resendEligible).toBe(false)
    expect(view.live).toBe(true)
  })

  it('reports nothing as actionable once the agreement is finished', async () => {
    agreementRow.status = 'completed'
    const view = await getEngagementStatus('agreement-1')

    expect(view.live).toBe(false)
    expect(view.recipients.every(r => !r.resendEligible)).toBe(true)
  })

  it('surfaces the last sync time so silence is distinguishable from unreachability', async () => {
    agreementRow.last_provider_sync_at = '2026-01-03T00:00:00Z'
    agreementRow.provider_sync_error = 'connect ETIMEDOUT'
    const view = await getEngagementStatus('agreement-1')

    expect(view.lastProviderSyncAt).toBe('2026-01-03T00:00:00Z')
    expect(view.providerSyncError).toBe('connect ETIMEDOUT')
  })
})

describe('resend', () => {
  it('re-notifies an eligible recipient and records the reminder', async () => {
    await resendEngagementRecipients({ agreementId: 'agreement-1', recipientIds: ['r1'] })

    expect(provider.resendDocumentRequest).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'req-1', recipientIds: ['x1'] }),
    )
    expect(updates).toContainEqual(expect.objectContaining({
      table: 'engagement_agreement_recipients',
      values: expect.objectContaining({ last_reminded_at: expect.any(String) }),
    }))
  })

  it('refuses to email someone who has already signed, even if asked to', async () => {
    // A stale browser must not be able to nag a client who is already done.
    await expect(resendEngagementRecipients({ agreementId: 'agreement-1', recipientIds: ['r2'] }))
      .rejects.toThrow(/no eligible unsigned recipient/i)
    expect(provider.resendDocumentRequest).not.toHaveBeenCalled()
  })

  it('refuses when the provider cannot resend, without calling it', async () => {
    capabilities = { ...capabilities, resend: false }

    await expect(resendEngagementRecipients({ agreementId: 'agreement-1', recipientIds: ['r1'] }))
      .rejects.toThrow(/does not support resending/i)
    expect(provider.resendDocumentRequest).not.toHaveBeenCalled()
  })

  it('refuses on a finished agreement', async () => {
    agreementRow.status = 'completed'

    await expect(resendEngagementRecipients({ agreementId: 'agreement-1', recipientIds: ['r1'] }))
      .rejects.toThrow(/cannot resend/i)
  })

  it('refuses a recipient with no provider identity rather than guessing', async () => {
    recipientRows[0].external_recipient_id = null

    await expect(resendEngagementRecipients({ agreementId: 'agreement-1', recipientIds: ['r1'] }))
      .rejects.toThrow(/no provider identity/i)
    expect(provider.resendDocumentRequest).not.toHaveBeenCalled()
  })
})

describe('cancel', () => {
  it('tells the provider before the database', async () => {
    await cancelEngagementRequest({ agreementId: 'agreement-1', reason: 'Fee revised' })

    // Marking it cancelled locally first would leave a live signing link for an
    // agreement the firm considers withdrawn.
    expect(calls.indexOf('provider.cancel'))
      .toBeLessThan(calls.indexOf('db.update.engagement_agreements'))
    expect(provider.cancelDocumentRequest).toHaveBeenCalledWith('req-1', 'Fee revised')
  })

  it('refuses to cancel a completed agreement', async () => {
    agreementRow.status = 'completed'

    await expect(cancelEngagementRequest({ agreementId: 'agreement-1', reason: 'too late' }))
      .rejects.toThrow(/completed agreement cannot be cancelled/i)
    expect(provider.cancelDocumentRequest).not.toHaveBeenCalled()
  })

  it('refuses when the provider cannot cancel, without calling it', async () => {
    capabilities = { ...capabilities, cancel: false }

    await expect(cancelEngagementRequest({ agreementId: 'agreement-1', reason: 'nope' }))
      .rejects.toThrow(/does not support cancelling/i)
    expect(provider.cancelDocumentRequest).not.toHaveBeenCalled()
  })
})
