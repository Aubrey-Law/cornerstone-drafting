/** Shared helpers for document API routes. */
import { createClient } from '@supabase/supabase-js'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getR2Client, R2_BUCKET } from '@/lib/r2'

export const DOCX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
export const PDF_CONTENT_TYPE = 'application/pdf'

export async function getDocumentApiUser(req: Request) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return null
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
  const { data: { user } } = await sb.auth.getUser(token)
  return user ?? null
}

export async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

export async function loadR2Bytes(r2Key: string): Promise<Buffer> {
  const r2 = getR2Client()
  const object = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: r2Key }))
  if (!object.Body) throw new Error('Document body not found')
  return streamToBuffer(object.Body as NodeJS.ReadableStream)
}

export function isDocxDocument(doc: { name: string; content_type?: string | null }) {
  return (
    doc.content_type === DOCX_CONTENT_TYPE ||
    doc.name.toLowerCase().endsWith('.docx')
  )
}
