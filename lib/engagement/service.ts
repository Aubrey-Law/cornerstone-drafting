import type { EsignDocumentRequestInput, EsignDocumentRequestResult } from '@/lib/esign/types'
import { validateEngagementInput } from './schema'
import type { EngagementInput } from './types'

export interface EngagementServiceAgreement {
  id: string
  status: string
  externalRequestId?: string | null
  inputSnapshot: EngagementInput
  activeRevision: { id: string; renderSha256: string; pdf: Buffer; masterVersion?: string }
  recipients: Array<{ key: string; name: string; email: string; order: number }>
}

export interface EngagementServiceRepository {
  createDraft(input: { matterId?: string; leadId?: string; preparedBy?: string | null; inputSnapshot: EngagementInput }): Promise<unknown>
  getAgreement(agreementId: string): Promise<EngagementServiceAgreement>
  createRevision(agreementId: string, rendered: EngagementRenderedRevision): Promise<unknown>
  claimSend(input: { agreementId: string; revisionId: string; renderSha256: string; approvalToken: string; sentBy: string }): Promise<unknown>
  releaseClaim(agreementId: string, error: string): Promise<void>
  recordRequest(agreementId: string, requestId: string): Promise<void>
  recordRecipients(agreementId: string, recipients: EsignDocumentRequestResult['recipients']): Promise<void>
  markSent(agreementId: string): Promise<void>
}

export interface EngagementRenderedRevision {
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
    getDocumentRequestState?(requestId: string): Promise<{ status: string }>
  }
  approval: {
    issue(input: { agreementId: string; revisionId: string; sha256: string; expiresInSeconds: number }): string
    verify(token: string, expected: { agreementId: string; revisionId: string; sha256: string }): { ok: true; claims: { nonce: string } } | { ok: false; error: string }
  }
}

function anchorsFor(recipients: EngagementServiceAgreement['recipients']): EsignDocumentRequestInput['anchors'] {
  return recipients.flatMap((recipient, index) => {
    const number = index + 1
    return [
      { marker: `[[CLIENT_${number}_SIGNATURE]]`, type: 'signature' as const, recipientKey: recipient.key, required: true },
      { marker: `[[CLIENT_${number}_DATE]]`, type: 'date' as const, recipientKey: recipient.key, required: true, dateSigningDefault: true },
    ]
  })
}

export function createEngagementService(deps: Dependencies) {
  return {
    async prepareAgreement(owner: { matterId?: string; leadId?: string; preparedBy?: string | null }, rawInput: unknown) {
      const validated = validateEngagementInput(rawInput)
      if (!validated.ok) throw new Error(`Invalid engagement input: ${validated.errors.join(', ')}`)
      return deps.repository.createDraft({ ...owner, inputSnapshot: validated.value })
    },

    async previewAgreement(agreementId: string, rawInput: unknown) {
      const validated = validateEngagementInput(rawInput)
      if (!validated.ok) throw new Error(`Invalid engagement input: ${validated.errors.join(', ')}`)
      const rendered = await deps.renderer.render(validated.value)
      if (!rendered.pdf.subarray(0, 4).equals(Buffer.from('%PDF'))) throw new Error('Renderer did not produce a PDF')
      return deps.repository.createRevision(agreementId, rendered)
    },

    async approveAgreementRevision(agreementId: string, expiresInSeconds = 900) {
      const agreement = await deps.repository.getAgreement(agreementId)
      return deps.approval.issue({ agreementId, revisionId: agreement.activeRevision.id, sha256: agreement.activeRevision.renderSha256, expiresInSeconds })
    },

    async sendApprovedAgreement(input: { agreementId: string; approvalToken: string; sentBy: string }) {
      const agreement = await deps.repository.getAgreement(input.agreementId)
      if (agreement.externalRequestId) return { requestId: agreement.externalRequestId, duplicate: true }
      const verified = deps.approval.verify(input.approvalToken, { agreementId: agreement.id, revisionId: agreement.activeRevision.id, sha256: agreement.activeRevision.renderSha256 })
      if (!verified.ok) throw new Error(verified.error)
      await deps.repository.claimSend({ agreementId: agreement.id, revisionId: agreement.activeRevision.id, renderSha256: agreement.activeRevision.renderSha256, approvalToken: input.approvalToken, sentBy: input.sentBy })
      let created: EsignDocumentRequestResult
      try {
        created = await deps.provider.createDocumentRequest({
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
        const state = await deps.provider.getDocumentRequestState?.(created.requestId).catch(() => null)
        if (!state || !['sent', 'viewed', 'partially_signed', 'completed'].includes(state.status)) throw error
      }
      await deps.repository.markSent(agreement.id)
      return { requestId: created.requestId, duplicate: false }
    },
  }
}
