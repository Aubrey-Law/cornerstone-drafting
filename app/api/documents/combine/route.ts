import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { Readable } from 'node:stream'
import { getR2Client, R2_BUCKET } from '@/lib/r2'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { MATTER_DOCUMENT_COLUMNS } from '@/lib/queryColumns'
import { combineDocxFiles } from '@/lib/docx/combineDocx'
import {
  auditDocumentAccess,
  userCanReadDocument,
} from '@/lib/documentSecurity'
import type { MatterDocument } from '@/types/database'

export const runtime = 'nodejs'

const MAX_COMBINE_DOCUMENTS = 25

async function getUser(req: Request) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return null
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
  const { data: { user } } = await sb.auth.getUser(token)
  return user ?? null
}

function safeFilename(name: string) {
  return name.replace(/[\/\\:*?"<>|]+/g, '_').replace(/^\.+/, '') || 'document'
}

function isDocxDocument(doc: Pick<MatterDocument, 'name' | 'content_type'>): boolean {
  return doc.name.toLowerCase().endsWith('.docx')
    || doc.content_type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
}

async function bufferFromR2(key: string): Promise<Uint8Array> {
  const obj = await getR2Client().send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }))
  const body = obj.Body
  if (!body) throw new Error('Document content unavailable')
  const nodeStream = body instanceof Readable
    ? body
    : Readable.from(body as unknown as AsyncIterable<Uint8Array>)
  const chunks: Buffer[] = []
  for await (const chunk of nodeStream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

// POST /api/documents/combine
//
// Combines the selected Word documents — in the order given — into a single
// .docx and returns it as a download. Every document keeps its own formatting
// (each is embedded as an OOXML altChunk that Word merges on open). Each
// included document is permission-checked and audited before any bytes leave.
export async function POST(req: Request) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { docIds?: unknown; filename?: unknown }
  const docIds = Array.isArray(body.docIds)
    ? body.docIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : []

  if (new Set(docIds).size !== docIds.length) {
    return NextResponse.json({ error: 'Each document can only be included once' }, { status: 400 })
  }
  if (docIds.length < 2) {
    return NextResponse.json({ error: 'Select at least two documents to combine' }, { status: 400 })
  }
  if (docIds.length > MAX_COMBINE_DOCUMENTS) {
    return NextResponse.json({ error: `Combining is limited to ${MAX_COMBINE_DOCUMENTS} documents` }, { status: 400 })
  }

  const admin = getAdminClient()
  const { data, error } = await admin
    .from('matter_documents')
    .select(MATTER_DOCUMENT_COLUMNS)
    .in('id', docIds)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const docsById = new Map(((data ?? []) as MatterDocument[]).map(doc => [doc.id, doc]))
  // Preserve the caller's requested order — it controls document order in the
  // combined file.
  const docs = docIds.map(id => docsById.get(id)).filter((doc): doc is MatterDocument => !!doc)
  if (docs.length !== docIds.length) {
    return NextResponse.json({ error: 'One or more selected documents could not be found' }, { status: 404 })
  }

  const nonWord = docs.filter(doc => !isDocxDocument(doc))
  if (nonWord.length > 0) {
    return NextResponse.json(
      { error: `Only Word (.docx) documents can be combined: ${nonWord.map(d => d.name).join(', ')}` },
      { status: 400 },
    )
  }

  for (const doc of docs) {
    if (!(await userCanReadDocument(admin, user, doc))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  for (const doc of docs) {
    const audit = await auditDocumentAccess(admin, user, doc, 'download', {
      bulk: true,
      folder: doc.folder,
      document_name: doc.name,
      route: '/api/documents/combine',
    })
    if (!audit.ok) {
      return NextResponse.json(
        { error: 'Audit log write failed; combine aborted' },
        { status: 500 },
      )
    }
  }

  let combined: Buffer
  try {
    const buffers = await Promise.all(docs.map(doc => bufferFromR2(doc.r2_key)))
    combined = await combineDocxFiles(buffers)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not combine documents' },
      { status: 500 },
    )
  }

  const requestedName = typeof body.filename === 'string' && body.filename.trim().length > 0
    ? safeFilename(body.filename.trim().replace(/\.docx$/i, ''))
    : 'combined-documents'

  return new Response(new Uint8Array(combined), {
    status: 200,
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'content-disposition': `attachment; filename="${requestedName}.docx"`,
      'cache-control': 'no-store',
    },
  })
}
