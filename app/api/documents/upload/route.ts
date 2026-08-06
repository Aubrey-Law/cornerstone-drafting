import { NextResponse } from 'next/server'
import { getBearerUser } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { isAdminUser, userCanAccessMatter } from '@/lib/documentSecurity'
import {
  ALLOWED_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  inferContentType,
  putFileToR2,
  safeUploadFilename,
} from '@/lib/documentUpload'
import { MATTER_DOCUMENT_COLUMNS } from '@/lib/queryColumns'

// POST /api/documents/upload — multipart proxy upload (avoids browser → R2 CORS)
export async function POST(req: Request) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid multipart body' }, { status: 400 })
  }

  const file = form.get('file')
  const matterId = String(form.get('matterId') ?? '').trim()

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing file' }, { status: 400 })
  }
  if (!matterId) {
    return NextResponse.json({ error: 'Missing matterId' }, { status: 400 })
  }
  if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `File must be between 1 byte and ${MAX_UPLOAD_BYTES} bytes` },
      { status: 400 },
    )
  }

  const contentType = inferContentType(file.name, file.type)
  if (!contentType) {
    return NextResponse.json(
      { error: `File type not permitted. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}` },
      { status: 400 },
    )
  }

  const admin = getAdminClient()
  if (!(await userCanAccessMatter(admin, user, matterId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Closed matters are read-only — no new uploads.
  const { data: matterStatus } = await admin
    .from('matters')
    .select('status')
    .eq('id', matterId)
    .single()
  if (matterStatus?.status === 'closed') {
    return NextResponse.json(
      { error: 'Matter is closed; uploads are not permitted', code: 'matter_closed' },
      { status: 409 },
    )
  }

  const isAdmin = await isAdminUser(admin, user)
  const source = isAdmin ? 'firm' : 'client'

  const timestamp = Date.now()
  const safeFilename = safeUploadFilename(file.name)
  const r2Key = `matters/${matterId}/${source}/${timestamp}-${safeFilename}`

  try {
    const bytes = Buffer.from(await file.arrayBuffer())
    await putFileToR2(r2Key, bytes, contentType)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('R2 upload error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  const { data, error } = await admin
    .from('matter_documents')
    .insert({
      matter_id: matterId,
      r2_key: r2Key,
      name: file.name,
      size: file.size,
      content_type: contentType,
      folder: isAdmin ? 'draft' : 'client',
      source: isAdmin ? 'firm' : 'client',
      shared_at: null,
      uploaded_by: user.id,
    })
    .select(MATTER_DOCUMENT_COLUMNS)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ document: data })
}

export const runtime = 'nodejs'
