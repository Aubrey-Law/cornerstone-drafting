import type { EsignDocumentRequestInput, EsignDocumentRequestResult, EsignDocumentRequestStatus } from '@/lib/esign/types'
import { validateEngagementInput } from './schema'
import type { EngagementInput } from './types'
import { engagementAnchorMarkers } from './anchors'

export interface EngagementServiceAgreement {
  id: string
  status: string
  externalRequestId?: string | null
  inputSnapshot: EngagementInput
  activeRevision: { id: string; renderSha256: string; pdf: Buffer; masterVersion?: string }
  recipients: Array<{ key: string; name: string; email: string; order: number; externalId?: string | null }>
}

export interface EngagementServiceRepository {
  createDraft(input: { matterId: string; preparedBy?: string | null; inputSnapshot: EngagementInput }): Promise<unknown>
  getAgreement(agreementId: string): Promise<EngagementServiceAgreement>
  createRevision(agreementId: string, rendered: EngagementRenderedRevision & { inputSnapshot: EngagementInput }): Promise<unknown>
  markReady(input: { agreementId: string; revisionId: string; renderSha256: string }): Promise<unknown>
  claimSend(input: { agreementId: string; revisionId: string; renderSha256: string; approvalToken: string; sentBy: string }): Promise<{ claimed: boolean }>
  claimResume(input: { agreementId: string; requestId: string; sentBy: string }): Promise<{ claimed: boolean }>
  releaseClaim(agreementId: string, error: string): Promise<void>
  recordRequest(agreementId: string, requestId: string): Promise<void>
  recordRecipients(agreementId: string, recipients: EsignDocumentRequestResult['recipients']): Promise<void>
  markSent(agreementId: string): Promise<void>
}

export interface EngagementRenderedRevision {
  docx?: Buffer
  pdf: Buffer
  renderSha256: string
  masterVersion: string
  renderSnapshot?: Record<string, unknown>
  pdfR2Key?: string | null
  htmlR2Key?: string | null
}

interface Dependencies {
  repository: EngagementServiceRepository
  renderer: { render(input: EngagementInput): Promise<EngagementRenderedRevision> }
  provider: {
    createDocumentRequest(input: EsignDocumentRequestInput): Promise<EsignDocumentRequestResult>
    sendDocumentRequest(requestId: string, customMessage: string): Promise<void>
    getDocumentRequestState(requestId: string): Promise<{ status: EsignDocumentRequestStatus; recipients?: EsignDocumentRequestResult['recipients'] }>
  }
  approval: {
    issue(input: { agreementId: string; revisionId: string; sha256: string; expiresInSeconds: number }): string
    verify(token: string, expected: { agreementId: string; revisionId: string; sha256: string }): { ok: true; claims: { nonce: string } } | { ok: false; error: string }
  }
}

function anchorsFor(recipients: EngagementServiceAgreement['recipients']): EsignDocumentRequestInput['anchors'] {
  return recipients.flatMap((recipient, index) => {
    const markers = engagementAnchorMarkers(index + 1)
    return [
      { marker: markers.signature, type: 'signature' as const, recipientKey: recipient.key, required: true },
      { marker: markers.date, type: 'date' as const, recipientKey: recipient.key, required: true, dateSigningDefault: true },
    ]
  })
}

export function createEngagementService(deps: Dependencies) {
  const sentStatuses: EsignDocumentRequestStatus[] = ['sent', 'viewed', 'partially_signed', 'completed']

  async function resumePersistedRequest(agreement: EngagementServiceAgreement, sentBy: string) {
    const requestId = agreement.externalRequestId as string
    const lease = await deps.repository.claimResume({ agreementId: agreement.id, requestId, sentBy })
    if (!lease.claimed) throw new Error('Engagement resume lease was not acquired')
    const state = await deps.provider.getDocumentRequestState(requestId)
    const missingMappings = agreement.recipients.some(recipient => !recipient.externalId)
    if (missingMappings) {
      const expectedKeys = [...agreement.recipients].sort((a, b) => a.order - b.order).map(recipient => recipient.key)
      const reconciled = state.recipients ?? []
      if (reconciled.length !== expectedKeys.length || expectedKeys.some(key => reconciled.filter(recipient => recipient.key === key).length !== 1)) {
        throw new Error('Provider reconciliation did not return exact recipient mappings')
      }
      await deps.repository.recordRecipients(agreement.id, reconciled)
    }
    if (sentStatuses.includes(state.status)) {
      if (agreement.status !== 'sent') await deps.repository.markSent(agreement.id)
      return { requestId, duplicate: true }
    }
    if (state.status !== 'created') throw new Error(`Cannot safely resume e-sign request in ${state.status} state`)
    await deps.provider.sendDocumentRequest(requestId, agreement.inputSnapshot.emailMessage)
    await deps.repository.markSent(agreement.id)
    return { requestId, duplicate: false }
  }

  return {
    async prepareAgreement(owner: { matterId: string; preparedBy?: string | null }, rawInput: unknown) {
      const validated = validateEngagementInput(rawInput)
      if (!validated.ok) throw new Error(`Invalid engagement input: ${validated.errors.join(', ')}`)
      return deps.repository.createDraft({ ...owner, inputSnapshot: validated.value })
    },

    async previewAgreement(agreementId: string, rawInput: unknown) {
      const validated = validateEngagementInput(rawInput)
      if (!validated.ok) throw new Error(`Invalid engagement input: ${validated.errors.join(', ')}`)
      const rendered = await deps.renderer.render(validated.value)
      if (!rendered.pdf.subarray(0, 4).equals(Buffer.from('%PDF'))) throw new Error('Renderer did not produce a PDF')
      const revision = await deps.repository.createRevision(agreementId, { ...rendered, inputSnapshot: validated.value })
      return { revision, rendered }
    },

    async approveAgreementRevision(input: { agreementId: string; revisionId: string; renderSha256: string }, expiresInSeconds = 900) {
      await deps.repository.markReady(input)
      return deps.approval.issue({ agreementId: input.agreementId, revisionId: input.revisionId, sha256: input.renderSha256, expiresInSeconds })
    },

    async sendApprovedAgreement(input: { agreementId: string; approvalToken: string; sentBy: string; revisionId: string; renderSha256: string }) {
      if (!input.revisionId.trim() || !input.renderSha256.trim()) throw new Error('Confirmed revision ID and PDF hash are required')
      const agreement = await deps.repository.getAgreement(input.agreementId)
      if (input.revisionId !== agreement.activeRevision.id || input.renderSha256 !== agreement.activeRevision.renderSha256) throw new Error('Confirmed revision does not match active revision')
      if (agreement.externalRequestId && ['sent', 'viewed', 'partially_signed', 'completed'].includes(agreement.status)) {
        return { requestId: agreement.externalRequestId, duplicate: true }
      }
      const verified = deps.approval.verify(input.approvalToken, { agreementId: agreement.id, revisionId: agreement.activeRevision.id, sha256: agreement.activeRevision.renderSha256 })
      if (!verified.ok) throw new Error(verified.error)
      if (agreement.externalRequestId) return resumePersistedRequest(agreement, input.sentBy)
      const claim = await deps.repository.claimSend({ agreementId: agreement.id, revisionId: agreement.activeRevision.id, renderSha256: agreement.activeRevision.renderSha256, approvalToken: input.approvalToken, sentBy: input.sentBy })
      if (!claim.claimed) throw new Error('Engagement send claim was not acquired')
      let created: EsignDocumentRequestResult
      try {
        created = await deps.provider.createDocumentRequest({
          agreementId: agreement.id,
          name: `Engagement Agreement — ${agreement.inputSnapshot.primary.name}`,
          document: agreement.activeRevision.pdf,
          recipients: [...agreement.recipients].sort((a, b) => a.order - b.order),
          anchors: anchorsFor([...agreement.recipients].sort((a, b) => a.order - b.order)),
          expirationHours: agreement.inputSnapshot.expirationHours,
          customMessage: agreement.inputSnapshot.emailMessage,
        })
      } catch (error) {
        await deps.repository.releaseClaim(agreement.id, error instanceof Error ? error.message : 'Firma create failed')
        throw error
      }
      await deps.repository.recordRequest(agreement.id, created.requestId)
      await deps.repository.recordRecipients(agreement.id, created.recipients)
      try {
        await deps.provider.sendDocumentRequest(created.requestId, agreement.inputSnapshot.emailMessage)
      } catch (error) {
        const state = await deps.provider.getDocumentRequestState(created.requestId).catch(() => null)
        if (!state || !sentStatuses.includes(state.status)) throw error
      }
      await deps.repository.markSent(agreement.id)
      return { requestId: created.requestId, duplicate: false }
    },
  }
}
