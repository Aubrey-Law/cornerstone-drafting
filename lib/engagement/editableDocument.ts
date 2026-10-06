import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { DOCX_CONTENT_TYPE, loadR2Bytes } from '@/lib/documentApiHelpers'
import { putFileToR2 } from '@/lib/documentUpload'
import { createDocumentVersion, ensureInitialVersion, loadActiveVersion } from '@/lib/documentVersions'
import { convertDocxToPdf } from '@/lib/docxPdfConvert'
import { extractTrackedChangeIds } from '@/lib/docxTrackedChanges'
import { allEngagementAnchorMarkers } from './anchors'
import { validateEngagementPdf } from './render'
import { createAgreementRevision } from './repository'
import { engagementTemplateFor } from './templates'
import type { EngagementInput } from './types'

/**
 * The engagement agreement as an editable Word document.
 *
 * Estate-planning drafts are edited as `matter_documents` rows: the in-app
 * viewer redlines them and the Word add-in saves new versions onto them. The
 * agreement's DOCX used to exist only inside each revision's render_snapshot,
 * so it could be downloaded but never edited and brought back. Each agreement
 * now owns one such row (`engagement_agreements.document_id`); every generated
 * revision writes a version to it, and `reviseEngagementFromDocument` turns
 * whatever the document now says into the next signing revision.
 */

export const ENGAGEMENT_DOCUMENT_NAME = 'Engagement Agreement.docx'
/** Kept apart from `draft/`, which is where estate-planning drafts live. */
const ENGAGEMENT_DOCUMENT_FOLDER = 'engagement'

const REVISABLE_STATUSES = ['draft', 'ready', 'failed']

export interface EngagementDocumentLink {
  documentId: string
  documentVersionId: string | null
}

export interface EngagementDocumentState {
  documentId: string
  name: string
  currentVersionId: string | null
}

/**
 * Write a generated DOCX to the agreement's document, creating the document on
 * the agreement's first generate. Returns the version the revision was built
 * from, so the workspace can tell later edits apart from it.
 */
export async function recordEngagementDocx(
  admin: SupabaseClient,
  input: { agreementId: string; docx: Buffer; createdBy?: string | null },
): Promise<EngagementDocumentLink> {
  const { data: agreement, error } = await admin
    .from('engagement_agreements')
    .select('matter_id, document_id')
    .eq('id', input.agreementId)
    .single()
  if (error || !agreement) throw new Error(error?.message ?? 'Engagement agreement not found')
  const matterId = String(agreement.matter_id)

  if (agreement.document_id) {
    const created = await createDocumentVersion({
      admin,
      documentId: agreement.document_id,
      matterId,
      bytes: input.docx,
      filename: ENGAGEMENT_DOCUMENT_NAME,
      contentType: DOCX_CONTENT_TYPE,
      source: 'generated',
      createdBy: input.createdBy ?? null,
      folder: ENGAGEMENT_DOCUMENT_FOLDER,
    })
    if ('error' in created) throw new Error(created.error)
    return { documentId: agreement.document_id, documentVersionId: created.version.id }
  }

  const r2Key = `matters/${matterId}/${ENGAGEMENT_DOCUMENT_FOLDER}/${input.agreementId}/${Date.now()}-engagement-agreement.docx`
  await putFileToR2(r2Key, input.docx, DOCX_CONTENT_TYPE)
  const { data: document, error: insertError } = await admin
    .from('matter_documents')
    .insert({
      matter_id: matterId,
      r2_key: r2Key,
      name: ENGAGEMENT_DOCUMENT_NAME,
      size: input.docx.byteLength,
      content_type: DOCX_CONTENT_TYPE,
      source: 'firm',
      // Staff-only until signed: the client receives the signing PDF, not this.
      shared_at: null,
      uploaded_by: input.createdBy ?? null,
    })
    .select('id')
    .single()
  if (insertError || !document) throw new Error(insertError?.message ?? 'Could not save the engagement document')

  const version = await ensureInitialVersion({
    admin,
    documentId: document.id,
    r2Key,
    filename: ENGAGEMENT_DOCUMENT_NAME,
    contentType: DOCX_CONTENT_TYPE,
    sizeBytes: input.docx.byteLength,
    source: 'generated',
    createdBy: input.createdBy ?? null,
  })
  const { error: linkError } = await admin
    .from('engagement_agreements')
    .update({ document_id: document.id })
    .eq('id', input.agreementId)
  if (linkError) throw new Error(linkError.message)
  return { documentId: document.id, documentVersionId: version?.id ?? null }
}

/** The agreement's document and its current version, for the workspace. */
export async function loadEngagementDocumentState(
  admin: SupabaseClient,
  documentId: string | null | undefined,
): Promise<EngagementDocumentState | null> {
  if (!documentId) return null
  const { data } = await admin
    .from('matter_documents')
    .select('id, name, current_version_id')
    .eq('id', documentId)
    .maybeSingle()
  if (!data) return null
  return { documentId: data.id, name: data.name, currentVersionId: data.current_version_id ?? null }
}

type RevisableAgreement = {
  status: string
  document_id?: string | null
  active_revision?: {
    input_snapshot: EngagementInput
    render_snapshot?: { documentVersionId?: string | null } | null
    master_version?: string | null
  } | null
}

/**
 * Build the next signing revision from the agreement's document as it stands —
 * after edits in the in-app viewer or in Word — instead of from the form.
 *
 * Tracked changes must be resolved first. The PDF is then held to the same rules as a generated one: US Letter, and every
 * signature and date anchor exactly once, because the signing request stamps
 * fields at those anchors. A new revision invalidates any earlier approval, so
 * the edited text is what gets reviewed and approved.
 */
export async function reviseEngagementFromDocument(
  admin: SupabaseClient,
  agreement: RevisableAgreement & { id: string },
  dependencies: { convertDocx?: typeof convertDocxToPdf } = {},
) {
  if (!REVISABLE_STATUSES.includes(agreement.status)) {
    throw new Error(`This agreement can no longer be revised (status ${agreement.status})`)
  }
  const active = agreement.active_revision
  if (!active) throw new Error('Generate the engagement agreement before using an edited document')
  if (!agreement.document_id) throw new Error('This agreement has no editable document yet; generate it first')

  const version = await loadActiveVersion(admin, agreement.document_id)
  if (!version) throw new Error('The engagement document has no saved version')
  if (version.id === active.render_snapshot?.documentVersionId) {
    throw new Error('The signing PDF already matches the current document')
  }

  const template = engagementTemplateFor(active.input_snapshot)
  if (!template) throw new Error('Engagement agreement template unavailable for this combination')

  const docx = await loadR2Bytes(version.r2_key)
  // A pending redline would print as markup in the client's signing PDF. The
  // viewer's AI edits arrive as tracked changes, so they have to be accepted or
  // rejected first — the same step an estate-planning draft goes through.
  const pending = await extractTrackedChangeIds(docx)
  if (pending.length > 0) {
    throw new Error(`The document has ${pending.length} unresolved tracked change${pending.length === 1 ? '' : 's'}. Accept or reject them (in the app or in Word) before using it for signature.`)
  }
  const pdf = await (dependencies.convertDocx ?? convertDocxToPdf)(docx, ENGAGEMENT_DOCUMENT_NAME)
  try {
    await validateEngagementPdf(pdf, allEngagementAnchorMarkers(template.recipientCount))
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'it failed validation'
    throw new Error(`The edited document cannot be sent for signature: ${reason}. Restore the signature and date lines, or regenerate from the form.`)
  }
  const sha256 = createHash('sha256').update(pdf).digest('hex')

  try {
    const { revision } = await createAgreementRevision(admin, agreement.id, {
      inputSnapshot: active.input_snapshot,
      renderSnapshot: {
        docxBase64: docx.toString('base64'),
        pdfBase64: pdf.toString('base64'),
        documentId: agreement.document_id,
        documentVersionId: version.id,
        source: 'document',
      },
      renderSha256: sha256,
      masterVersion: active.master_version ?? '0',
    })
    return { revision, sha256, docx, pdf, documentVersionId: version.id }
  } catch (error) {
    if (error instanceof Error && /render_sha256/.test(error.message)) {
      throw new Error('This document is identical to an earlier revision of the agreement')
    }
    throw error
  }
}
