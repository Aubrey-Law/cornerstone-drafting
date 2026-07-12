import { describe, expect, it, vi } from 'vitest'
import { createEngagementService } from '@/lib/engagement/service'

const input = {
  practiceArea: 'EP' as const, clientMode: 'individual' as const, agreementDate: '2026-07-12',
  primary: { name: 'Ada Lovelace', email: 'ada@example.com' }, spouse: null, legalPlan: null,
  fee: { amount: 1000, paymentTerms: 'Due now' }, scopeKey: 'standard', optionalClauseKeys: [],
  emailMessage: 'Please sign', expirationHours: 72,
}

describe('engagement service', () => {
  const approval = { issue: vi.fn(), verify: vi.fn().mockReturnValue({ ok: true, claims: { agreementId: 'a1', revisionId: 'r1', sha256: 'hash', nonce: 'n' } }) }
  const agreement = { id: 'a1', status: 'ready', inputSnapshot: input, activeRevision: { id: 'r1', renderSha256: 'hash', pdf: Buffer.from('%PDF') }, recipients: [{ key: 'primary', name: 'Ada Lovelace', email: 'ada@example.com', order: 1 }] }

  it('rejects stale approval before claiming or calling Firma', async () => {
    const repository = { getAgreement: vi.fn().mockResolvedValue({ id: 'a1', activeRevision: { id: 'r2', renderSha256: 'new' } }), claimSend: vi.fn() }
    const provider = { createDocumentRequest: vi.fn() }
    const service = createEngagementService({ repository: repository as never, provider: provider as never, renderer: {} as never, approval: { issue: vi.fn(), verify: vi.fn().mockReturnValue({ ok: false, error: 'approval does not match revision' }) } })
    await expect(service.sendApprovedAgreement({ agreementId: 'a1', approvalToken: 'old', sentBy: 'u1' })).rejects.toThrow('approval does not match revision')
    expect(repository.claimSend).not.toHaveBeenCalled()
    expect(provider.createDocumentRequest).not.toHaveBeenCalled()
  })

  it('sends one recipient, persists the external request, and returns duplicate sends', async () => {
    const repository = {
      getAgreement: vi.fn().mockResolvedValueOnce(agreement).mockResolvedValueOnce({ ...agreement, status: 'sent', externalRequestId: 'firma-1' }),
      claimSend: vi.fn().mockResolvedValue({ claimed: true }), recordRequest: vi.fn(), markSent: vi.fn(), releaseClaim: vi.fn(), recordRecipients: vi.fn(),
    }
    const provider = { createDocumentRequest: vi.fn().mockResolvedValue({ requestId: 'firma-1', recipients: [{ key: 'primary', externalId: 'recipient-1', signingLink: null }] }), sendDocumentRequest: vi.fn(), getDocumentRequestState: vi.fn() }
    const service = createEngagementService({ repository: repository as never, provider: provider as never, renderer: {} as never, approval })
    expect(await service.sendApprovedAgreement({ agreementId: 'a1', approvalToken: 'token', sentBy: 'u1' })).toEqual({ requestId: 'firma-1', duplicate: false })
    expect(provider.createDocumentRequest.mock.calls[0][0].recipients).toHaveLength(1)
    expect(repository.recordRequest).toHaveBeenCalledWith('a1', 'firma-1')
    expect(repository.recordRecipients).toHaveBeenCalled()
    expect(await service.sendApprovedAgreement({ agreementId: 'a1', approvalToken: 'token', sentBy: 'u1' })).toEqual({ requestId: 'firma-1', duplicate: true })
    expect(provider.createDocumentRequest).toHaveBeenCalledTimes(1)
  })

  it('never calls the provider after losing the atomic claim', async () => {
    const repository = { getAgreement: vi.fn().mockResolvedValue(agreement), claimSend: vi.fn().mockResolvedValue({ claimed: false }) }
    const provider = { createDocumentRequest: vi.fn() }
    const service = createEngagementService({ repository: repository as never, provider: provider as never, renderer: {} as never, approval })
    await expect(service.sendApprovedAgreement({ agreementId: 'a1', approvalToken: 'token', sentBy: 'u1' })).rejects.toThrow(/claim/i)
    expect(provider.createDocumentRequest).not.toHaveBeenCalled()
  })

  it('releases the claim when request creation fails', async () => {
    const repository = { getAgreement: vi.fn().mockResolvedValue(agreement), claimSend: vi.fn().mockResolvedValue({ claimed: true }), releaseClaim: vi.fn() }
    const provider = { createDocumentRequest: vi.fn().mockRejectedValue(new Error('create failed')) }
    const service = createEngagementService({ repository: repository as never, provider: provider as never, renderer: {} as never, approval })
    await expect(service.sendApprovedAgreement({ agreementId: 'a1', approvalToken: 'token', sentBy: 'u1' })).rejects.toThrow('create failed')
    expect(repository.releaseClaim).toHaveBeenCalledWith('a1', 'create failed')
  })

  it('resumes a persisted created request and marks it sent only after reconciliation', async () => {
    const persisted = { ...agreement, status: 'sending', externalRequestId: 'firma-1', recipients: [{ ...agreement.recipients[0], externalId: 'recipient-1' }] }
    const repository = { getAgreement: vi.fn().mockResolvedValue(persisted), markSent: vi.fn(), claimSend: vi.fn(), claimResume: vi.fn().mockResolvedValue({ claimed: true }) }
    const provider = { getDocumentRequestState: vi.fn().mockResolvedValue({ status: 'created', recipients: [{ key: 'primary', externalId: 'recipient-1', signingLink: null }] }), sendDocumentRequest: vi.fn() }
    const service = createEngagementService({ repository: repository as never, provider: provider as never, renderer: {} as never, approval })
    expect(await service.sendApprovedAgreement({ agreementId: 'a1', approvalToken: 'token', sentBy: 'u1' })).toEqual({ requestId: 'firma-1', duplicate: false })
    expect(provider.sendDocumentRequest).toHaveBeenCalledWith('firma-1', 'Please sign')
    expect(repository.markSent).toHaveBeenCalledWith('a1')
  })

  it('does not send when another caller owns the resume lease', async () => {
    const persisted = { ...agreement, status: 'sending', externalRequestId: 'firma-1', recipients: [{ ...agreement.recipients[0], externalId: 'recipient-1' }] }
    const repository = { getAgreement: vi.fn().mockResolvedValue(persisted), claimResume: vi.fn().mockResolvedValue({ claimed: false }) }
    const provider = { getDocumentRequestState: vi.fn(), sendDocumentRequest: vi.fn() }
    const service = createEngagementService({ repository: repository as never, provider: provider as never, renderer: {} as never, approval })
    await expect(service.sendApprovedAgreement({ agreementId: 'a1', approvalToken: 'token', sentBy: 'u1' })).rejects.toThrow(/resume lease/i)
    expect(provider.sendDocumentRequest).not.toHaveBeenCalled()
  })

  it('repairs missing exact recipient mappings before resuming send', async () => {
    const persisted = { ...agreement, status: 'sending', externalRequestId: 'firma-1' }
    const exact = [{ key: 'primary', externalId: 'recipient-1', signingLink: 'https://sign/1' }]
    const repository = { getAgreement: vi.fn().mockResolvedValue(persisted), claimResume: vi.fn().mockResolvedValue({ claimed: true }), recordRecipients: vi.fn(), markSent: vi.fn() }
    const provider = { getDocumentRequestState: vi.fn().mockResolvedValue({ status: 'created', recipients: exact }), sendDocumentRequest: vi.fn() }
    const service = createEngagementService({ repository: repository as never, provider: provider as never, renderer: {} as never, approval })
    await service.sendApprovedAgreement({ agreementId: 'a1', approvalToken: 'token', sentBy: 'u1' })
    expect(repository.recordRecipients).toHaveBeenCalledWith('a1', exact)
    expect(provider.sendDocumentRequest).toHaveBeenCalled()
  })

  it('repairs recipient persistence failure on a leased resume before sending', async () => {
    const persisted = { ...agreement, status: 'sending', externalRequestId: 'firma-1' }
    const exact = [{ key: 'primary', externalId: 'recipient-1', signingLink: null }]
    const repository = { getAgreement: vi.fn().mockResolvedValueOnce(agreement).mockResolvedValueOnce(persisted), claimSend: vi.fn().mockResolvedValue({ claimed: true }), claimResume: vi.fn().mockResolvedValue({ claimed: true }), recordRequest: vi.fn(), recordRecipients: vi.fn().mockRejectedValueOnce(new Error('recipient persistence failed')).mockResolvedValueOnce(undefined), markSent: vi.fn(), releaseClaim: vi.fn() }
    const provider = { createDocumentRequest: vi.fn().mockResolvedValue({ requestId: 'firma-1', recipients: exact }), sendDocumentRequest: vi.fn(), getDocumentRequestState: vi.fn().mockResolvedValue({ status: 'created', recipients: exact }) }
    const service = createEngagementService({ repository: repository as never, provider: provider as never, renderer: {} as never, approval })
    await expect(service.sendApprovedAgreement({ agreementId: 'a1', approvalToken: 'token', sentBy: 'u1' })).rejects.toThrow('recipient persistence failed')
    expect(provider.sendDocumentRequest).not.toHaveBeenCalled()
    expect(repository.markSent).not.toHaveBeenCalled()
    await expect(service.sendApprovedAgreement({ agreementId: 'a1', approvalToken: 'token', sentBy: 'u1' })).resolves.toEqual({ requestId: 'firma-1', duplicate: false })
    expect(repository.recordRecipients).toHaveBeenLastCalledWith('a1', exact)
    expect(provider.sendDocumentRequest).toHaveBeenCalledWith('firma-1', 'Please sign')
  })

  it('orders couple recipients and anchors deterministically', async () => {
    const couple = { ...agreement, recipients: [{ key: 'spouse', name: 'Grace', email: 'g@example.com', order: 2 }, agreement.recipients[0]] }
    const repository = { getAgreement: vi.fn().mockResolvedValue(couple), claimSend: vi.fn().mockResolvedValue({ claimed: true }), recordRequest: vi.fn(), recordRecipients: vi.fn(), markSent: vi.fn(), releaseClaim: vi.fn() }
    const provider = { createDocumentRequest: vi.fn().mockResolvedValue({ requestId: 'firma-1', recipients: [] }), sendDocumentRequest: vi.fn(), getDocumentRequestState: vi.fn() }
    const service = createEngagementService({ repository: repository as never, provider: provider as never, renderer: {} as never, approval })
    await service.sendApprovedAgreement({ agreementId: 'a1', approvalToken: 'token', sentBy: 'u1' })
    expect(provider.createDocumentRequest.mock.calls[0][0].recipients.map((r: { key: string }) => r.key)).toEqual(['primary', 'spouse'])
    expect(provider.createDocumentRequest.mock.calls[0][0].anchors.map((a: { recipientKey: string }) => a.recipientKey)).toEqual(['primary', 'primary', 'spouse', 'spouse'])
  })

  it('prepare, preview, and approve use the current validated revision', async () => {
    const repository = { createDraft: vi.fn().mockResolvedValue({ id: 'a1' }), createRevision: vi.fn().mockResolvedValue({ id: 'r2' }), markReady: vi.fn().mockResolvedValue({ id: 'a1' }), getAgreement: vi.fn().mockResolvedValue({ ...agreement, activeRevision: { ...agreement.activeRevision, id: 'r2', renderSha256: 'new' } }) }
    const rendered = { docx: Buffer.from('PK docx'), pdf: Buffer.from('%PDF new'), renderSha256: 'new', masterVersion: 'v1' }
    const renderer = { render: vi.fn().mockResolvedValue(rendered) }
    const service = createEngagementService({ repository: repository as never, provider: {} as never, renderer, approval })
    await service.prepareAgreement({ matterId: 'm1' }, input)
    await expect(service.previewAgreement('a1', input)).resolves.toEqual({ revision: { id: 'r2' }, rendered })
    await service.approveAgreementRevision({ agreementId: 'a1', revisionId: 'r2', renderSha256: 'new' })
    expect(repository.createRevision).toHaveBeenCalledWith('a1', expect.objectContaining({ renderSha256: 'new' }))
    expect(repository.markReady).toHaveBeenCalledWith({ agreementId: 'a1', revisionId: 'r2', renderSha256: 'new' })
    expect(approval.issue).toHaveBeenCalledWith(expect.objectContaining({ revisionId: 'r2', sha256: 'new' }))
  })

  it('never approves a different active revision than the caller reviewed', async () => {
    const repository = { markReady: vi.fn().mockRejectedValue(new Error('Engagement persistence returned no row')) }
    const service = createEngagementService({ repository: repository as never, provider: {} as never, renderer: {} as never, approval })
    await expect(service.approveAgreementRevision({ agreementId: 'a1', revisionId: 'r1', renderSha256: 'old' })).rejects.toThrow(/no row/)
    expect(approval.issue).not.toHaveBeenCalledWith(expect.objectContaining({ revisionId: 'r1' }))
  })

  it('rejects send when explicit confirmed revision differs before provider use', async () => {
    const repository = { getAgreement: vi.fn().mockResolvedValue(agreement) }
    const provider = { createDocumentRequest: vi.fn() }
    const service = createEngagementService({ repository: repository as never, provider: provider as never, renderer: {} as never, approval })
    await expect(service.sendApprovedAgreement({ agreementId: 'a1', approvalToken: 'token', sentBy: 'u1', revisionId: 'other', renderSha256: 'hash' })).rejects.toThrow(/confirmed revision/i)
    expect(provider.createDocumentRequest).not.toHaveBeenCalled()
  })
})
