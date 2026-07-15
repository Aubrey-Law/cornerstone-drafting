import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { MATTER_DOCUMENT_COLUMNS } from '@/lib/queryColumns'
import { combineDocxFiles } from '@/lib/docx/combineDocx'
import {
  getDocumentApiUser,
  isDocxDocument,
  loadR2Bytes,
} from '@/lib/documentApiHelpers'
import {
  auditDocumentAccess,
  userCanReadDocument,
} from '@/lib/documentSecurity'
import type { MatterDocument } from '@/types/database'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_COMBINE_DOCUMENTS = 25

function safeFilename(name: string) {
  return name.replace(/[\/\\:*?"<>|]+/g, '_').replace(/^\.+/, '') || 'document'
}

// POST /api/documents/combine
//
// Combines the selected Word documents — in the order given — into a single
// .docx and returns it as a download. Every document keeps its own formatting
// (each is embedded as an OOXML altChunk that Word merges on open). Each
// included document is permission-checked and audited before any bytes leave.
export async function POST(req: Request) {
  // The whole handler reports failures as JSON: an escaped exception would
  // surface as a platform error page the client can't show to the attorney.
  try {
    return await combineSelectedDocuments(req)
  } catch (e) {
    console.error('documents/combine failed', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not combine documents' },
      { status: 500 },
    )
  }
}

async function combineSelectedDocuments(req: Request) {
  const user = await getDocumentApiUser(req)
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

  // Sequential fetches: a parallel batch that partially fails leaves orphaned
  // response streams whose late errors can crash the function outside any
  // catch. A named per-document error beats raw speed here.
  const buffers: Uint8Array[] = []
  for (const doc of docs) {
    try {
      buffers.push(await loadR2Bytes(doc.r2_key))
    } catch (e) {
      console.error(`documents/combine could not load ${doc.id} (${doc.name})`, e)
      return NextResponse.json(
        { error: `Could not load "${doc.name}" from storage` },
        { status: 500 },
      )
    }
  }
  const combined = await combineDocxFiles(buffers)

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
