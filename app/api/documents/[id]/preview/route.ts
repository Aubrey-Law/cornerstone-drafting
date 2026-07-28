import { GetObjectCommand } from '@aws-sdk/client-s3'
import { NextResponse } from 'next/server'
import { getBearerUser } from '@/lib/apiAuth'
import { auditDocumentAccess, userCanReadDocument } from '@/lib/documentSecurity'
import { MATTER_DOCUMENT_COLUMNS } from '@/lib/queryColumns'
import { getR2Client, R2_BUCKET } from '@/lib/r2'
import { getAdminClient } from '@/lib/supabaseAdmin'

const DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const sb = getAdminClient()
  const { data: doc, error } = await sb
    .from('matter_documents')
    .select(MATTER_DOCUMENT_COLUMNS)
    .eq('id', id)
    .single()
  if (error || !doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (!(await userCanReadDocument(sb, user, doc))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const isDocx =
    doc.content_type === DOCX_CONTENT_TYPE ||
    doc.name.toLowerCase().endsWith('.docx')
  if (!isDocx) {
    return NextResponse.json({ error: 'Preview is only available for DOCX documents' }, { status: 415 })
  }

  const audit = await auditDocumentAccess(sb, user, doc, 'view', {
    route: '/api/documents/[id]/preview',
    preview_type: 'docx-html',
  })
  if (!audit.ok) {
    return NextResponse.json(
      { error: 'Audit log write failed; access denied', code: 'audit_failed' },
      { status: 503 },
    )
  }

  try {
    const r2 = getR2Client()
    const object = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: doc.r2_key }))
    if (!object.Body) return NextResponse.json({ error: 'Document body not found' }, { status: 404 })

    const buffer = await streamToBuffer(object.Body as NodeJS.ReadableStream)
    const mammoth = await import('mammoth')
    const { value } = await mammoth.convertToHtml({ buffer }, {
      styleMap: [
        "p[style-name='Title'] => h1:fresh",
        "p[style-name='Heading 1'] => h1:fresh",
        "p[style-name='Heading 2'] => h2:fresh",
        "p[style-name='Heading 3'] => h3:fresh",
      ],
    })

    return NextResponse.json({ html: value })
  } catch (previewError) {
    console.error('DOCX preview error:', previewError)
    return NextResponse.json({ error: 'Could not render document preview' }, { status: 500 })
  }
}
