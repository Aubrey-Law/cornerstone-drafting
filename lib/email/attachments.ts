import 'server-only'

import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getR2Client, r2Bucket } from '@/lib/r2'
import type { getAdminClient } from '@/lib/supabaseAdmin'

/**
 * Files sent alongside a manual email — either picked from a matter's
 * documents or uploaded from the operator's computer.
 */
export interface EmailAttachment {
  filename: string
  /** Raw bytes; each provider encodes them its own way. */
  content: Buffer
  contentType?: string
}

/**
 * Total attachment budget for one send.
 *
 * Resend allows far more, but Microsoft Graph's `sendMail` rejects request
 * bodies over ~4MB (anything larger needs an upload session), so keep the cap
 * modest and let the provider's own error surface if it still refuses.
 */
export const MAX_TOTAL_ATTACHMENT_BYTES = 10 * 1024 * 1024

export const MAX_ATTACHMENT_COUNT = 10

export function totalAttachmentBytes(attachments: EmailAttachment[]): number {
  return attachments.reduce((sum, item) => sum + item.content.byteLength, 0)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

type Admin = ReturnType<typeof getAdminClient>

/**
 * Pull matter documents out of R2 so they can ride along with the email.
 * Documents are scoped to the matter the compose pane is looking at — an id
 * from another matter is dropped rather than fetched.
 */
export async function loadMatterDocumentAttachments(
  admin: Admin,
  matterId: string,
  documentIds: string[],
): Promise<EmailAttachment[]> {
  if (documentIds.length === 0) return []

  const { data, error } = await admin
    .from('matter_documents')
    .select('id, name, r2_key, content_type, matter_id')
    .eq('matter_id', matterId)
    .in('id', documentIds.slice(0, MAX_ATTACHMENT_COUNT))
  if (error) throw new Error(error.message)

  const r2 = getR2Client()
  const attachments: EmailAttachment[] = []

  for (const row of data ?? []) {
    const key = row.r2_key as string | null
    if (!key) continue
    const object = await r2.send(new GetObjectCommand({ Bucket: r2Bucket(), Key: key }))
    const bytes = await object.Body?.transformToByteArray()
    if (!bytes) continue
    attachments.push({
      filename: (row.name as string | null)?.trim() || 'document',
      content: Buffer.from(bytes),
      contentType: (row.content_type as string | null) ?? undefined,
    })
  }

  return attachments
}
