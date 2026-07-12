import { describe, expect, it, vi } from 'vitest'
import { createEngagementService } from '@/lib/engagement/service'

const input = {
  practiceArea: 'EP' as const, clientMode: 'individual' as const, agreementDate: '2026-07-12',
  primary: { name: 'Ada Lovelace', email: 'ada@example.com' }, spouse: null, legalPlan: null,
  fee: { amount: 1000, paymentTerms: 'Due now' }, scopeKey: 'revocable-trust', optionalClauseKeys: [],
  emailMessage: 'Please sign', expirationHours: 72,
}

describe('engagement service', () => {
  it('rejects stale approval before claiming or calling Firma', async () => {
    const repository = { getAgreement: vi.fn().mockResolvedValue({ id: 'a1', activeRevision: { id: 'r2', renderSha256: 'new' } }), claimSend: vi.fn() }
    const provider = { createDocumentRequest: vi.fn() }
    const service = createEngagementService({ repository: repository as never, provider: provider as never, renderer: {} as never, approval: { issue: vi.fn(), verify: vi.fn().mockReturnValue({ ok: false, error: 'approval does not match revision' }) } })
    await expect(service.sendApprovedAgreement({ agreementId: 'a1', approvalToken: 'old', sentBy: 'u1' })).rejects.toThrow('approval does not match revision')
    expect(repository.claimSend).not.toHaveBeenCalled()
    expect(provider.createDocumentRequest).not.toHaveBeenCalled()
  })

  it('sends one recipient, persists the external request, and returns duplicate sends', async () => {
    const agreement = { id: 'a1', status: 'ready', inputSnapshot: input, activeRevision: { id: 'r1', renderSha256: 'hash', pdf: Buffer.from('%PDF') }, recipients: [{ key: 'primary', name: 'Ada Lovelace', email: 'ada@example.com', order: 1 }] }
    const repository = {
      getAgreement: vi.fn().mockResolvedValueOnce(agreement).mockResolvedValueOnce({ ...agreement, status: 'sent', externalRequestId: 'firma-1' }),
      claimSend: vi.fn().mockResolvedValue({ claimed: true }), recordRequest: vi.fn(), markSent: vi.fn(), releaseClaim: vi.fn(), recordRecipients: vi.fn(),
    }
    const provider = { createDocumentRequest: vi.fn().mockResolvedValue({ requestId: 'firma-1', recipients: [{ key: 'primary', externalId: 'recipient-1', signingLink: null }] }), sendDocumentRequest: vi.fn(), getDocumentRequestState: vi.fn() }
    const approval = { issue: vi.fn(), verify: vi.fn().mockReturnValue({ ok: true, claims: { agreementId: 'a1', revisionId: 'r1', sha256: 'hash', nonce: 'n' } }) }
    const service = createEngagementService({ repository: repository as never, provider: provider as never, renderer: {} as never, approval })
    expect(await service.sendApprovedAgreement({ agreementId: 'a1', approvalToken: 'token', sentBy: 'u1' })).toEqual({ requestId: 'firma-1', duplicate: false })
    expect(provider.createDocumentRequest.mock.calls[0][0].recipients).toHaveLength(1)
    expect(repository.recordRequest).toHaveBeenCalledWith('a1', 'firma-1')
    expect(repository.recordRecipients).toHaveBeenCalled()
    expect(await service.sendApprovedAgreement({ agreementId: 'a1', approvalToken: 'token', sentBy: 'u1' })).toEqual({ requestId: 'firma-1', duplicate: true })
    expect(provider.createDocumentRequest).toHaveBeenCalledTimes(1)
  })
})
