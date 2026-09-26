import crypto from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { GeneratedDatabase } from '@/types/supabase'
import { putFileToR2 } from '@/lib/documentUpload'
import { deleteR2Key } from '@/lib/r2Delete'
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

const R2_STORAGE: UploadStorage = { write: putFileToR2, remove: deleteR2Key }

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
  client: SupabaseClient<GeneratedDatabase>,
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

export interface ReviewUploadRecord {
  id: string
  label: string
  filename: string
  fileKind: ExtractorKind
  r2Key: string
  /** The matter it was linked to later, if any. See 20261228090000_review_upload_matter_link.sql. */
  matterId: string | null
  linkedAt: string | null
}

export async function loadReviewUpload(
  client: SupabaseClient<GeneratedDatabase>,
  reviewUploadId: string,
): Promise<ReviewUploadRecord | null> {
  const { data, error } = await client
    .from('review_uploads')
    .select('id, label, filename, file_kind, r2_key, matter_id, linked_at')
    .eq('id', reviewUploadId)
    .maybeSingle()
  if (error) throw new Error(`Could not load the upload: ${error.message}`)
  if (!data) return null
  return {
    id: String(data.id),
    label: String(data.label),
    filename: String(data.filename),
    fileKind: data.file_kind === 'pdf' ? 'pdf' : 'docx',
    r2Key: String(data.r2_key),
    matterId: data.matter_id ? String(data.matter_id) : null,
    linkedAt: data.linked_at ? String(data.linked_at) : null,
  }
}

export type LinkUploadResult = { ok: true } | { ok: false; message: string }

/**
 * Links an upload to a matter, or unlinks it with `matterId: null`.
 *
 * Only the upload row changes. Its review runs keep `matter_id` null, so a
 * review of someone else's plan never enters the matter's own run history as
 * though it were a review of the firm's draft (see the migration's header).
 * The link does change what a *new* review of the upload sees: the matter's
 * design sheet, so its rule conditions apply.
 */
export async function linkReviewUpload(
  client: SupabaseClient<GeneratedDatabase>,
  input: { reviewUploadId: string; matterId: string | null; userId: string },
): Promise<LinkUploadResult> {
  if (input.matterId) {
    const { data: matter, error } = await client.from('matters').select('id').eq('id', input.matterId).maybeSingle()
    if (error) return { ok: false, message: `Could not look up the matter: ${error.message}` }
    if (!matter) return { ok: false, message: 'That matter no longer exists.' }
  }

  const { data, error } = await client
    .from('review_uploads')
    .update({
      matter_id: input.matterId,
      linked_at: input.matterId ? new Date().toISOString() : null,
      linked_by: input.matterId ? input.userId : null,
    })
    .eq('id', input.reviewUploadId)
    .select('id')
  if (error) return { ok: false, message: `Could not update the link: ${error.message}` }
  if (!data || data.length === 0) return { ok: false, message: 'That upload no longer exists.' }
  return { ok: true }
}

export interface LinkableMatter {
  matterId: string
  title: string
}

/** Matters an upload can be linked to, newest first. A prior plan often arrives before its design sheet does. */
export async function loadLinkableMatters(
  client: SupabaseClient<GeneratedDatabase>,
  limit = 500,
): Promise<LinkableMatter[]> {
  const { data, error } = await client
    .from('matters')
    .select('id, name')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`Could not load matters: ${error.message}`)
  return (data ?? []).map((matter) => ({
    matterId: String(matter.id),
    title: (matter.name as string | null) ?? 'Untitled matter',
  }))
}
