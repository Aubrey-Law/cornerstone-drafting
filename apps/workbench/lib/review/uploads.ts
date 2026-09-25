import crypto from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from '@/lib/supabase/database'
import { deleteObject, writeObject } from '@/lib/storage/r2'
import type { ExtractorKind } from './run'

/**
 * Keeping an unfiled upload so its review can be recorded.
 *
 * A review is only worth recording if it can be returned to: the findings,
 * their citations and the attorney's dispositions all point at the document
 * they are about. A filed document already has a durable identity
 * (`document_versions`); an upload gets one here — the bytes in R2 and a
 * `review_uploads` row — so the same run, finding and citation tables can
 * hold its review.
 *
 * Its own key prefix, apart from filed documents: nothing that lists or
 * serves a matter's documents reads under `review-uploads/`, so an upload
 * cannot surface on a matter's documents tab or in the client portal.
 */

export interface StoreUploadInput {
  bytes: Buffer
  filename: string
  kind: ExtractorKind
  label: string
  userId: string | null
}

export interface UploadStorage {
  write: (key: string, bytes: Buffer, contentType: string) => Promise<void>
  remove: (key: string) => Promise<void>
}

const R2_STORAGE: UploadStorage = { write: writeObject, remove: deleteObject }

const CONTENT_TYPES: Record<ExtractorKind, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

/** The label an attorney gave, or the filename without its extension when they gave none. */
export function uploadLabel(label: string | null | undefined, filename: string): string {
  const given = label?.trim().replace(/\s+/g, ' ').slice(0, 200)
  if (given) return given
  return filename.replace(/\.(docx|pdf)$/i, '').trim() || filename
}

/** Only the characters an R2 key and a download header both take without escaping. */
export function safeFilename(filename: string): string {
  const cleaned = filename.normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '')
  return cleaned.slice(-120) || 'document'
}

export type StoreUploadResult = { ok: true; reviewUploadId: string } | { ok: false; message: string }

export async function storeReviewUpload(
  client: SupabaseClient<WorkbenchDatabase>,
  input: StoreUploadInput,
  storage: UploadStorage = R2_STORAGE,
): Promise<StoreUploadResult> {
  const key = `review-uploads/${crypto.randomUUID()}/${safeFilename(input.filename)}`

  try {
    await storage.write(key, input.bytes, CONTENT_TYPES[input.kind])
  } catch (error) {
    return { ok: false, message: `Could not store the upload: ${error instanceof Error ? error.message : 'unknown error'}` }
  }

  const { data, error } = await client
    .from('review_uploads')
    .insert({
      label: uploadLabel(input.label, input.filename),
      filename: input.filename,
      file_kind: input.kind,
      r2_key: key,
      size_bytes: input.bytes.length,
      sha256: crypto.createHash('sha256').update(input.bytes).digest('hex'),
      created_by: input.userId,
    })
    .select('id')
    .single()

  if (error || !data) {
    // Undone rather than left behind: an object with no row is a client's
    // document stored where nothing will ever find it to delete it.
    await storage.remove(key).catch(() => undefined)
    return { ok: false, message: `Could not record the upload: ${error?.message ?? 'no row returned'}` }
  }
  return { ok: true, reviewUploadId: String(data.id) }
}
