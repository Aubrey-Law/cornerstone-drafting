import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getR2Client, R2_BUCKET } from '@/lib/r2'

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024 // 50 MB

export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/markdown',
  'image/jpeg',
  'image/png',
  'image/tiff',
] as const

const EXTENSION_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  md: 'text/markdown',
  markdown: 'text/markdown',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  tiff: 'image/tiff',
  tif: 'image/tiff',
}

export function inferContentType(filename: string, declared?: string | null): string | null {
  const trimmed = (declared ?? '').trim()
  if (trimmed && (ALLOWED_MIME_TYPES as readonly string[]).includes(trimmed)) {
    return trimmed
  }
  const ext = filename.includes('.') ? filename.split('.').pop()?.toLowerCase() : undefined
  if (!ext) return null
  const fromExt = EXTENSION_MIME[ext]
  return fromExt && (ALLOWED_MIME_TYPES as readonly string[]).includes(fromExt) ? fromExt : null
}

export function safeUploadFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._\-]/g, '_')
}

export async function putFileToR2(
  r2Key: string,
  body: Buffer | Uint8Array,
  contentType: string,
): Promise<void> {
  const r2 = getR2Client()
  await r2.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: r2Key,
      Body: body,
      ContentType: contentType,
    }),
  )
}
