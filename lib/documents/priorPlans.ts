import type { SupabaseClient } from '@supabase/supabase-js'
import { loadR2Bytes } from '@/lib/documentApiHelpers'
import { putFileToR2, safeUploadFilename } from '@/lib/documentUpload'
import { MATTER_DOCUMENT_COLUMNS } from '@/lib/queryColumns'
import { deleteR2Key } from '@/lib/r2Delete'
import type { MatterDocument } from '@/types/database'

/**
 * Prior plans: documents reviewed in the workbench before they were filed.
 *
 * A prospective client brings in the plan another firm drafted, it is reviewed
 * as an unfiled upload (`review_uploads`), and once they hire the firm it is
 * linked to their matter. Linking records the association only. Filing — this
 * module — is the deliberate step that puts a copy in the matter's documents:
 *
 * - A copy, under the matter's own key prefix. The upload's bytes stay where
 *   its recorded reviews cite them, so deleting or editing the matter document
 *   cannot break those reviews, and nothing that lists a matter's documents
 *   reads under `review-uploads/`.
 * - `source: 'client'`, because the client provided it, and unshared: another
 *   firm's plan reaches the portal only if an attorney shares it, through the
 *   same share gate as any document.
 * - Marked reviewed, because it was: the attorney is filing it from its review.
 * - Once. The key is derived from the upload's id, so two filings racing each
 *   other collide on `matter_documents.r2_key` instead of making two copies,
 *   and `review_uploads.filed_document_id` records the document it became.
 */

export interface PriorPlan {
  id: string
  label: string
  filename: string
  fileKind: 'docx' | 'pdf'
  sizeBytes: number
  reviewedAt: string
  linkedAt: string | null
  filedDocumentId: string | null
}

export const PRIOR_PLAN_CONTENT_TYPES: Record<PriorPlan['fileKind'], string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

const PRIOR_PLAN_COLUMNS = 'id, label, filename, file_kind, size_bytes, created_at, linked_at, filed_document_id, matter_id, r2_key'

type PriorPlanRow = {
  id: string
  label: string
  filename: string
  file_kind: string
  size_bytes: number
  created_at: string
  linked_at: string | null
  filed_document_id: string | null
  matter_id: string | null
  r2_key: string
}

function toPriorPlan(row: PriorPlanRow): PriorPlan {
  return {
    id: row.id,
    label: row.label,
    filename: row.filename,
    fileKind: row.file_kind === 'pdf' ? 'pdf' : 'docx',
    sizeBytes: row.size_bytes,
    reviewedAt: row.created_at,
    linkedAt: row.linked_at,
    filedDocumentId: row.filed_document_id,
  }
}

/** Uploads linked to this matter, newest link first, filed or not. */
export async function listPriorPlans(admin: SupabaseClient, matterId: string): Promise<PriorPlan[]> {
  const { data, error } = await admin
    .from('review_uploads')
    .select(PRIOR_PLAN_COLUMNS)
    .eq('matter_id', matterId)
    .order('linked_at', { ascending: false })
  if (error) throw new Error(error.message)
  return ((data ?? []) as PriorPlanRow[]).map(toPriorPlan)
}

/** The matter document's name: the attorney's label, keeping the file's extension. */
export function priorPlanDocumentName(label: string, fileKind: PriorPlan['fileKind']): string {
  const extension = `.${fileKind}`
  return label.toLowerCase().endsWith(extension) ? label : `${label}${extension}`
}

/** Where the copy lives: the matter's client-document prefix, named for the upload so a second filing collides. */
export function priorPlanR2Key(matterId: string, reviewUploadId: string, filename: string): string {
  return `matters/${matterId}/client/prior-plan-${reviewUploadId}-${safeUploadFilename(filename)}`
}

export interface PriorPlanStorage {
  read: (key: string) => Promise<Buffer>
  write: (key: string, bytes: Buffer, contentType: string) => Promise<void>
  remove: (key: string) => Promise<void>
}

const R2_STORAGE: PriorPlanStorage = { read: loadR2Bytes, write: putFileToR2, remove: deleteR2Key }

export type FilePriorPlanResult =
  | { ok: true; document: MatterDocument; alreadyFiled: boolean }
  | { ok: false; status: 404 | 409 | 500; code: string; message: string }

async function loadDocument(admin: SupabaseClient, column: 'id' | 'r2_key', value: string) {
  const { data } = await admin
    .from('matter_documents')
    .select(MATTER_DOCUMENT_COLUMNS)
    .eq(column, value)
    .maybeSingle()
  return (data as MatterDocument | null) ?? null
}

/** Records which document the upload became. Only the first filing wins; a later one leaves it. */
async function recordFiling(admin: SupabaseClient, reviewUploadId: string, documentId: string) {
  const { error } = await admin
    .from('review_uploads')
    .update({ filed_document_id: documentId })
    .eq('id', reviewUploadId)
    .is('filed_document_id', null)
  if (error) console.warn('[priorPlans] could not record the filing', reviewUploadId, error.message)
}

export async function filePriorPlan(
  admin: SupabaseClient,
  input: { reviewUploadId: string; matterId: string; userId: string },
  storage: PriorPlanStorage = R2_STORAGE,
): Promise<FilePriorPlanResult> {
  const { data: row, error: loadError } = await admin
    .from('review_uploads')
    .select(PRIOR_PLAN_COLUMNS)
    .eq('id', input.reviewUploadId)
    .maybeSingle()
  if (loadError) return { ok: false, status: 500, code: 'load_failed', message: loadError.message }
  const upload = row as PriorPlanRow | null
  if (!upload) return { ok: false, status: 404, code: 'not_found', message: 'That upload no longer exists.' }

  // Filing follows the link, never a matter the caller names on its own: the
  // link is the attorney's decision about whose plan this is.
  if (upload.matter_id !== input.matterId) {
    return {
      ok: false,
      status: 409,
      code: 'not_linked',
      message: 'That upload is not linked to this matter. Link it from its review first.',
    }
  }

  if (upload.filed_document_id) {
    const existing = await loadDocument(admin, 'id', upload.filed_document_id)
    if (existing) return { ok: true, document: existing, alreadyFiled: true }
  }

  const { data: matter } = await admin.from('matters').select('status').eq('id', input.matterId).maybeSingle()
  if ((matter as { status?: string } | null)?.status === 'closed') {
    return { ok: false, status: 409, code: 'matter_closed', message: 'Matter is closed; documents cannot be added.' }
  }

  const fileKind = toPriorPlan(upload).fileKind
  const contentType = PRIOR_PLAN_CONTENT_TYPES[fileKind]
  const key = priorPlanR2Key(input.matterId, upload.id, upload.filename)

  try {
    const bytes = await storage.read(upload.r2_key)
    await storage.write(key, bytes, contentType)
  } catch (error) {
    return {
      ok: false,
      status: 500,
      code: 'copy_failed',
      message: `Could not copy the upload: ${error instanceof Error ? error.message : 'unknown error'}`,
    }
  }

  const now = new Date().toISOString()
  const { data: inserted, error: insertError } = await admin
    .from('matter_documents')
    .insert({
      matter_id: input.matterId,
      r2_key: key,
      name: priorPlanDocumentName(upload.label, fileKind),
      size: upload.size_bytes,
      content_type: contentType,
      source: 'client',
      shared_at: null,
      uploaded_by: input.userId,
      reviewed_at: now,
      reviewed_by: input.userId,
    })
    .select(MATTER_DOCUMENT_COLUMNS)
    .single()

  if (insertError) {
    // Another filing of the same upload got there first. Its row owns the key
    // (and the bytes just written over it are the same bytes), so use it.
    if (insertError.code === '23505') {
      const winner = await loadDocument(admin, 'r2_key', key)
      if (winner) {
        await recordFiling(admin, upload.id, winner.id)
        return { ok: true, document: winner, alreadyFiled: true }
      }
    }
    await storage.remove(key)
    return { ok: false, status: 500, code: 'insert_failed', message: insertError.message }
  }

  const document = inserted as MatterDocument
  await recordFiling(admin, upload.id, document.id)
  return { ok: true, document, alreadyFiled: false }
}
