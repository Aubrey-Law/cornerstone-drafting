import { NextRequest, NextResponse } from 'next/server'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { getR2Client, R2_BUCKET } from '@/lib/r2'
import { INTAKE_DOCUMENT_COLUMNS } from '@/lib/intake/intakeDocumentColumns'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const { id } = await params
  if (!id?.trim()) {
    return NextResponse.json({ error: 'Missing document id' }, { status: 400 })
  }

  const admin = getAdminClient()
  const { data: doc, error } = await admin
    .from('intake_documents')
    .select(INTAKE_DOCUMENT_COLUMNS)
    .eq('id', id)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!doc?.r2_key) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  try {
    const url = await getSignedUrl(
      getR2Client(),
      new GetObjectCommand({ Bucket: R2_BUCKET, Key: doc.r2_key }),
      { expiresIn: 300 },
    )
    return NextResponse.json({ url, document: doc })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Download failed'
    console.error('admin intake document presign error:', message)
    return NextResponse.json({ error: 'Storage error' }, { status: 500 })
  }
}
