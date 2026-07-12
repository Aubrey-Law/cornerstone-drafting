import { getAdminClient } from '@/lib/supabaseAdmin'
import { createFirmaEsignProvider } from '@/lib/esign/firma'
import { issueRevisionApproval, verifyRevisionApproval } from './approval'
import { renderEngagementAgreement } from './render'
import * as repository from './repository'
import { createEngagementService } from './service'

export function engagementService() {
  const client = getAdminClient()
  return createEngagementService({
    repository: {
      createDraft: input => repository.createAgreementDraft(client, { ...input, renderSha256: 'unrendered', masterVersion: '0' }),
      getAgreement: async id => {
        const row = await repository.getAgreement(client, id) as any
        const snapshot = row.active_revision.input_snapshot
        const render = row.active_revision.render_snapshot ?? {}
        return {
          id: row.id, status: row.status, externalRequestId: row.firma_request_id,
          inputSnapshot: snapshot,
          activeRevision: { id: row.active_revision.id, renderSha256: row.active_revision.render_sha256, pdf: Buffer.from(render.pdfBase64 ?? '', 'base64'), masterVersion: row.active_revision.master_version },
          recipients: (row.recipients ?? []).map((r: any) => ({ key: r.role, name: r.name, email: r.email, order: r.recipient_order, externalId: r.firma_recipient_id })),
        }
      },
      createRevision: (id, rendered) => repository.createAgreementRevision(client, id, rendered as any),
      markReady: input => repository.markAgreementReady(client, input),
      claimSend: input => repository.claimAgreementSend(client, input),
      claimResume: input => repository.claimAgreementResume(client, input),
      releaseClaim: (id, error) => repository.releaseAgreementClaim(client, id, error),
      recordRequest: (id, requestId) => repository.recordFirmaRequest(client, id, requestId),
      recordRecipients: (id, recipients) => repository.recordFirmaRecipients(client, id, recipients),
      markSent: id => repository.markAgreementSent(client, id),
    },
    renderer: { render: async input => {
      const rendered = await renderEngagementAgreement(input)
      return { docx: rendered.docxBytes, pdf: rendered.pdfBytes, renderSha256: rendered.pdfSha256, masterVersion: rendered.masterVersion, renderSnapshot: { docxBase64: rendered.docxBytes.toString('base64'), pdfBase64: rendered.pdfBytes.toString('base64') } }
    } },
    provider: createFirmaEsignProvider({ apiKey: process.env.FIRMA_API_KEY ?? '', singleTemplateId: process.env.FIRMA_ENGAGEMENT_TEMPLATE_ID ?? '', jointTemplateId: process.env.FIRMA_ENGAGEMENT_TEMPLATE_ID_JOINT ?? null }),
    approval: { issue: issueRevisionApproval, verify: verifyRevisionApproval },
  })
}
