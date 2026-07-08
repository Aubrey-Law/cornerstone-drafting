/**
 * document_versions helpers for matter_documents.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { putFileToR2, safeUploadFilename } from '@/lib/documentUpload'

export type DocumentVersionSource =
  | 'upload'
  | 'generated'
  | 'assistant_edit'
  | 'user_upload'
  | 'user_accept'
  | 'user_reject'
  | 'converted_pdf'

export interface DocumentVersion {
  id: string
  document_id: string
  r2_key: string
  pdf_r2_key: string | null
  source: DocumentVersionSource
  version_number: number
  filename: string | null
  file_type: string | null
  size_bytes: number
  created_by: string | null
  created_at: string
  deleted_at: string | null
}

const VERSION_COLUMNS =
  'id, document_id, r2_key, pdf_r2_key, source, version_number, filename, file_type, size_bytes, created_by, created_at, deleted_at'

export async function nextVersionNumber(
  admin: SupabaseClient,
  documentId: string,
): Promise<number> {
  const { data } = await admin
    .from('document_versions')
    .select('version_number')
    .eq('document_id', documentId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data?.version_number ?? 0) + 1
}

export async function loadActiveVersion(
  admin: SupabaseClient,
  documentId: string,
  versionId?: string | null,
): Promise<DocumentVersion | null> {
  if (versionId) {
    const { data } = await admin
      .from('document_versions')
      .select(VERSION_COLUMNS)
      .eq('id', versionId)
      .eq('document_id', documentId)
      .is('deleted_at', null)
      .maybeSingle()
    return (data as DocumentVersion | null) ?? null
  }

  const { data: doc } = await admin
    .from('matter_documents')
    .select('current_version_id')
    .eq('id', documentId)
    .maybeSingle()

  if (doc?.current_version_id) {
    const { data } = await admin
      .from('document_versions')
      .select(VERSION_COLUMNS)
      .eq('id', doc.current_version_id)
      .is('deleted_at', null)
      .maybeSingle()
    if (data) return data as DocumentVersion
  }

  // Fallback: latest non-deleted version
  const { data: latest } = await admin
    .from('document_versions')
    .select(VERSION_COLUMNS)
    .eq('document_id', documentId)
    .is('deleted_at', null)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (latest as DocumentVersion | null) ?? null
}

export async function listDocumentVersions(
  admin: SupabaseClient,
  documentId: string,
): Promise<DocumentVersion[]> {
  const { data } = await admin
    .from('document_versions')
    .select(VERSION_COLUMNS)
    .eq('document_id', documentId)
    .is('deleted_at', null)
    .order('version_number', { ascending: false })
  return (data ?? []) as DocumentVersion[]
}

export function versionR2Key(args: {
  matterId: string
  documentId: string
  filename: string
  folder?: string
}): string {
  const safe = safeUploadFilename(args.filename)
  const folder = args.folder ?? 'draft'
  return `matters/${args.matterId}/${folder}/versions/${args.documentId}/${Date.now()}-${safe}`
}

export async function createDocumentVersion(args: {
  admin: SupabaseClient
  documentId: string
  matterId: string
  bytes: Buffer | Uint8Array
  filename: string
  contentType: string
  source: DocumentVersionSource
  createdBy: string | null
  setCurrent?: boolean
  folder?: string
}): Promise<{ version: DocumentVersion } | { error: string }> {
  const versionNumber = await nextVersionNumber(args.admin, args.documentId)
  const r2Key = versionR2Key({
    matterId: args.matterId,
    documentId: args.documentId,
    filename: args.filename,
    folder: args.folder,
  })

  try {
    await putFileToR2(r2Key, args.bytes, args.contentType)
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'R2 upload failed' }
  }

  const { data, error } = await args.admin
    .from('document_versions')
    .insert({
      document_id: args.documentId,
      r2_key: r2Key,
      source: args.source,
      version_number: versionNumber,
      filename: args.filename,
      file_type: args.contentType,
      size_bytes: args.bytes.byteLength,
      created_by: args.createdBy,
    })
    .select(VERSION_COLUMNS)
    .single()

  if (error || !data) return { error: error?.message ?? 'version insert failed' }

  if (args.setCurrent !== false) {
    await args.admin
      .from('matter_documents')
      .update({
        current_version_id: data.id,
        r2_key: r2Key,
        size: args.bytes.byteLength,
        name: args.filename,
        content_type: args.contentType,
      })
      .eq('id', args.documentId)
  }

  return { version: data as DocumentVersion }
}

/** Create an initial version row pointing at an existing matter_documents.r2_key (no re-upload). */
export async function ensureInitialVersion(args: {
  admin: SupabaseClient
  documentId: string
  r2Key: string
  filename: string
  contentType: string
  sizeBytes: number
  source: DocumentVersionSource
  createdBy: string | null
}): Promise<DocumentVersion | null> {
  const existing = await loadActiveVersion(args.admin, args.documentId)
  if (existing) return existing

  const { data, error } = await args.admin
    .from('document_versions')
    .insert({
      document_id: args.documentId,
      r2_key: args.r2Key,
      source: args.source,
      version_number: 1,
      filename: args.filename,
      file_type: args.contentType,
      size_bytes: args.sizeBytes,
      created_by: args.createdBy,
    })
    .select(VERSION_COLUMNS)
    .single()

  if (error || !data) {
    console.warn('[documentVersions] ensureInitialVersion failed', error?.message)
    return null
  }

  await args.admin
    .from('matter_documents')
    .update({ current_version_id: data.id })
    .eq('id', args.documentId)

  return data as DocumentVersion
}
