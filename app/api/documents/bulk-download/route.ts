import { NextResponse } from 'next/server'
import { getBearerUser } from '@/lib/apiAuth'
import archiver from 'archiver'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { Readable } from 'node:stream'
import { getR2Client, R2_BUCKET } from '@/lib/r2'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { MATTER_DOCUMENT_COLUMNS } from '@/lib/queryColumns'
import { userCanReadDocument } from '@/lib/documentSecurity'
import type { MatterDocument } from '@/types/database'

export const runtime = 'nodejs'

const MAX_BULK_DOWNLOAD_DOCUMENTS = 100

function safeFilename(name: string) {
  return name.replace(/[\/\\:*?"<>|]+/g, '_').replace(/^\.+/, '') || 'document'
}

function archiveEntryName(doc: Pick<MatterDocument, 'name' | 'folder'>, seen: Map<string, number>) {
  const base = safeFilename(doc.name)
  const folder = safeFilename(doc.folder || 'documents')
  const key = `${folder}/${base}`
  const count = seen.get(key) ?? 0
  seen.set(key, count + 1)
  return count === 0 ? key : `${folder}/${count + 1}_${base}`
}

// POST /api/documents/bulk-download
//
// Streams a zip of specifically selected documents. Each included document is
// permission-checked and audited before any bytes are returned.
export async function POST(req: Request) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { docIds?: unknown }
  const docIds = Array.isArray(body.docIds)
    ? Array.from(new Set(body.docIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)))
    : []

  if (docIds.length === 0) {
    return NextResponse.json({ error: 'Select at least one document to download' }, { status: 400 })
  }
  if (docIds.length > MAX_BULK_DOWNLOAD_DOCUMENTS) {
    return NextResponse.json({ error: `Bulk downloads are limited to ${MAX_BULK_DOWNLOAD_DOCUMENTS} documents` }, { status: 400 })
  }

  const admin = getAdminClient()
  const { data, error } = await admin
    .from('matter_documents')
    .select(MATTER_DOCUMENT_COLUMNS)
    .in('id', docIds)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const docsById = new Map(((data ?? []) as MatterDocument[]).map(doc => [doc.id, doc]))
  const docs = docIds.map(id => docsById.get(id)).filter((doc): doc is MatterDocument => !!doc)
  if (docs.length !== docIds.length) {
    return NextResponse.json({ error: 'One or more selected documents could not be found' }, { status: 404 })
  }

  for (const doc of docs) {
    if (!(await userCanReadDocument(admin, user, doc))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const r2 = getR2Client()
  const archive = archiver('zip', { zlib: { level: 6 } })

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      archive.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)))
      archive.on('end', () => controller.close())
      archive.on('error', (e: Error) => controller.error(e))

      ;(async () => {
        try {
          const seen = new Map<string, number>()
          for (const doc of docs) {
            const obj = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: doc.r2_key }))
            const body = obj.Body
            if (!body) continue
            const nodeStream = body instanceof Readable
              ? body
              : Readable.from(body as unknown as AsyncIterable<Uint8Array>)
            archive.append(nodeStream, { name: archiveEntryName(doc, seen) })
          }
          await archive.finalize()
        } catch (e) {
          archive.emit('error', e)
        }
      })()
    },
  })

  const filename = docs.length === 1
    ? `${safeFilename(docs[0].name.replace(/\.[^/.]+$/, ''))}.zip`
    : `selected-documents-${docs.length}.zip`

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  })
}
