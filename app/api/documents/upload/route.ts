import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAdminClient } from '@/lib/supabaseAdmin'
import {
  isAdminUser,
  isClientUploadFolder,
  userCanAccessMatter,
} from '@/lib/documentSecurity'
import { pdfRequiredUploadReason } from '@/lib/documentSharing'
import {
  ALLOWED_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  inferContentType,
  putFileToR2,
  safeUploadFilename,
} from '@/lib/documentUpload'
import { MATTER_DOCUMENT_COLUMNS } from '@/lib/queryColumns'
import type { MatterDocument } from '@/types/database'

const VALID_FOLDERS = new Set(['draft', 'final', 'client', 'review', 'signed', 'intake', 'meeting-notes'])

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

// POST /api/documents/upload — multipart proxy upload (avoids browser → R2 CORS)
export async function POST(req: Request) {
  const user = await getUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid multipart body' }, { status: 400 })
  }

  const file = form.get('file')
  const matterId = String(form.get('matterId') ?? '').trim()
  const folder = String(form.get('folder') ?? 'client').trim()
  const folderIdRaw = form.get('folderId')
  const folderId = folderIdRaw && String(folderIdRaw).trim() ? String(folderIdRaw).trim() : null

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing file' }, { status: 400 })
  }
  if (!matterId) {
    return NextResponse.json({ error: 'Missing matterId' }, { status: 400 })
  }
  if (!VALID_FOLDERS.has(folder)) {
    return NextResponse.json({ error: `Invalid folder: ${folder}` }, { status: 400 })
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
  const isAdmin = await isAdminUser(admin, user)
  if (!isAdmin && !isClientUploadFolder(folder)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const pdfBlock = isAdmin
    ? pdfRequiredUploadReason(folder as MatterDocument['folder'], file.name, contentType)
    : null
  if (pdfBlock) {
    return NextResponse.json({ error: pdfBlock, code: 'pdf_required' }, { status: 409 })
  }

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

  const timestamp = Date.now()
  const safeFilename = safeUploadFilename(file.name)
  const r2Key = `matters/${matterId}/${folder}/${timestamp}-${safeFilename}`

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
      folder,
      folder_id: folderId,
      uploaded_by: user.id,
    })
    .select(MATTER_DOCUMENT_COLUMNS)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ document: data })
}

export const runtime = 'nodejs'
