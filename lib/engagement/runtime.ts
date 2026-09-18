import { getAdminClient } from '@/lib/supabaseAdmin'
import { createFirmaEsignProvider } from '@/lib/esign/firma'
import { createNativeEsignProvider, esignNativeEnabled } from '@/lib/esign/native'
import { issueRevisionApproval, verifyRevisionApproval } from './approval'
import { renderEngagementAgreement } from './render'
import * as repository from './repository'
import { createEngagementService } from './service'
import { markEngagementSentStatus } from './status'
import type { EngagementInput } from './types'

/**
 * What this adapter reads off a persisted agreement.
 *
 * `repository.getAgreement` widens its row to `Record<string, unknown>`, so the
 * named columns are invisible to the compiler and the call used to be cast
 * `as any`. That cast hid something real: `active_revision` is genuinely null
 * when an agreement has no active revision, and every line below dereferenced
 * it. The type names the nullability so the case has to be answered.
 */
type PersistedAgreement = {
  id: string
  status: string
  external_request_id?: string | null
  firma_request_id?: string | null
  active_revision: {
    id: string
    input_snapshot: EngagementInput
    render_snapshot?: { pdfBase64?: string } | null
    render_sha256: string
    master_version?: string
  } | null
  recipients?: Array<{
    role: string
    name: string
    email: string
    recipient_order: number
    external_recipient_id?: string | null
    firma_recipient_id?: string | null
  }> | null
}

/**
 * Pick the signing provider for this send.
 *
 * The whole cutover is this function. `lib/engagement/service.ts` is pure and
 * dependency-injected, so it never learns which provider it got — if it ever
 * needs to, the seam is being bypassed.
 *
 * Read per call rather than cached: flipping the flag has to take effect
 * without a deploy, because the reason to flip it back is usually urgent.
 */
async function selectEsignProvider() {
  return await esignNativeEnabled()
    ? createNativeEsignProvider()
    : createFirmaEsignProvider({
      apiKey: process.env.FIRMA_API_KEY ?? '',
      singleTemplateId: process.env.FIRMA_ENGAGEMENT_TEMPLATE_ID ?? '',
      jointTemplateId: process.env.FIRMA_ENGAGEMENT_TEMPLATE_ID_JOINT ?? null,
    })
}

export async function engagementService() {
  const client = getAdminClient()
  const provider = await selectEsignProvider()
  return createEngagementService({
    repository: {
      createDraft: input => repository.createAgreementDraft(client, { ...input, renderSha256: 'unrendered', masterVersion: '0' }),
      getAgreement: async id => {
        const row = await repository.getAgreement(client, id) as unknown as PersistedAgreement
        const revision = row.active_revision
        // The service's agreement always has one, so say which agreement is
        // missing it rather than throwing a TypeError three lines later.
        if (!revision) throw new Error(`Engagement agreement ${id} has no active revision`)
        const render = revision.render_snapshot ?? {}
        return {
          id: row.id, status: row.status, externalRequestId: row.external_request_id ?? row.firma_request_id,
          inputSnapshot: revision.input_snapshot,
          activeRevision: { id: revision.id, renderSha256: revision.render_sha256, pdf: Buffer.from(render.pdfBase64 ?? '', 'base64'), masterVersion: revision.master_version },
          recipients: (row.recipients ?? []).map(r => ({ key: r.role, name: r.name, email: r.email, order: r.recipient_order, externalId: r.external_recipient_id ?? r.firma_recipient_id })),
        }
      },
      createRevision: (id, rendered) => repository.createAgreementRevision(client, id, rendered),
      markReady: input => repository.markAgreementReady(client, input),
      claimSend: input => repository.claimAgreementSend(client, input),
      claimResume: input => repository.claimAgreementResume(client, input),
      releaseClaim: (id, error) => repository.releaseAgreementClaim(client, id, error),
      recordRequest: async (id, requestId) => {
        await repository.recordExternalRequest(client, id, requestId, provider.name)
      },
      recordRecipients: (id, recipients) => repository.recordExternalRecipients(client, id, recipients, provider.name),
      markSent: async id => {
        const row = await repository.markAgreementSent(client, id) as { matter_id?: string | null } | null
        if (row?.matter_id) {
          // The envelope is already out; a status-mirror failure must not fail
          // the send, so it is logged rather than thrown.
          try {
            await markEngagementSentStatus(client, row.matter_id)
          } catch (e) {
            console.error('[engagement] matter status sync after send failed', e)
          }
        }
      },
    },
    renderer: { render: async input => {
      const rendered = await renderEngagementAgreement(input)
      return { docx: rendered.docxBytes, pdf: rendered.pdfBytes, renderSha256: rendered.pdfSha256, masterVersion: rendered.masterVersion, renderSnapshot: { docxBase64: rendered.docxBytes.toString('base64'), pdfBase64: rendered.pdfBytes.toString('base64') } }
    } },
    provider,
    approval: { issue: issueRevisionApproval, verify: verifyRevisionApproval },
  })
}
