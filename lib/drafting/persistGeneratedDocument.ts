import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getR2Client, r2Bucket } from '@/lib/r2'

export const DOCX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

// Structural admin-client shape so both the typed and untyped Supabase admin
// clients used across routes are accepted.
type AdminClient = {
  from: (table: string) => {
    insert: (values: Record<string, unknown>) => {
      select: (columns: string) => {
        single: () => Promise<{ data: { id: string } | null; error: { message: string } | null }>
      }
    }
  }
}

export interface UploadDraftBufferArgs {
  matterId: string
  buffer: Buffer
  documentName: string
  contentType?: string
}

/** Upload a generated draft buffer to R2 under the matter's draft prefix. */
export async function uploadDraftBufferToR2(args: UploadDraftBufferArgs): Promise<string> {
  const contentType = args.contentType ?? DOCX_CONTENT_TYPE
  const r2 = getR2Client()
  const safeFilename = args.documentName.replace(/[^a-zA-Z0-9._-]/g, '_')
  const r2Key = `matters/${args.matterId}/draft/${Date.now()}-${safeFilename}`

  const uploadUrl = await getSignedUrl(
    r2,
    new PutObjectCommand({
      Bucket: r2Bucket(),
      Key: r2Key,
      ContentType: contentType,
    }),
    { expiresIn: 300 },
  )
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    body: args.buffer,
    headers: { 'Content-Type': contentType },
  })
  if (!putRes.ok) {
    throw new Error(`R2 upload failed for ${args.documentName}: ${putRes.status} ${putRes.statusText}`)
  }
  return r2Key
}

export interface RegisterDraftDocumentRowArgs {
  admin: unknown
  matterId: string
  r2Key: string
  documentName: string
  buffer: Buffer
  actorId: string
  generationId: string
  generationEngine: string
  markerCount: number
  missingCount: number
  templateId?: string | null
  templateVersionId?: string | null
  contentType?: string
}

/**
 * Register an already-uploaded draft in `matter_documents` (folder `draft`)
 * and record its initial document version. Returns the raw insert result so
 * callers keep their own error handling/logging.
 */
export async function registerDraftDocumentRow(
  args: RegisterDraftDocumentRowArgs,
): Promise<{ data: { id: string } | null; error: { message: string } | null }> {
  const contentType = args.contentType ?? DOCX_CONTENT_TYPE
  const admin = args.admin as AdminClient
  const { data, error } = await admin.from('matter_documents').insert({
    matter_id: args.matterId,
    r2_key: args.r2Key,
    name: args.documentName,
    size: args.buffer.length,
    content_type: contentType,
    source: 'firm',
    shared_at: null,
    uploaded_by: args.actorId,
    generation_id: args.generationId,
    generation_engine: args.generationEngine,
    marker_count: args.markerCount,
    missing_count: args.missingCount,
    template_id: args.templateId ?? null,
    template_version_id: args.templateVersionId ?? null,
  }).select('id').single()

  if (data?.id) {
    try {
      const { ensureInitialVersion } = await import('@/lib/documentVersions')
      await ensureInitialVersion({
        admin: args.admin as never,
        documentId: data.id,
        r2Key: args.r2Key,
        filename: args.documentName,
        contentType,
        sizeBytes: args.buffer.length,
        source: 'generated',
        createdBy: args.actorId,
      })
    } catch (versionErr) {
      // Versions table may not exist yet on firm DB — non-fatal.
      console.warn('[persistGeneratedDocument] ensureInitialVersion skipped', versionErr)
    }
  }

  return { data, error }
}

export type PersistDraftDocumentArgs = UploadDraftBufferArgs & Omit<RegisterDraftDocumentRowArgs, 'r2Key'>

/** Upload + register in one call; throws on any failure. Used by quick draft. */
export async function persistDraftDocument(args: PersistDraftDocumentArgs): Promise<{ documentId: string; r2Key: string }> {
  const r2Key = await uploadDraftBufferToR2(args)
  const { data, error } = await registerDraftDocumentRow({ ...args, r2Key })
  if (error) {
    throw new Error(`Failed to register document "${args.documentName}": ${error.message}`)
  }
  if (!data?.id) {
    throw new Error(`Failed to register document "${args.documentName}": no document ID returned`)
  }
  return { documentId: data.id, r2Key }
}
