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
import { isUuid } from '@/lib/queries/tasks'
import { markDocumentRequestReceived } from '@/lib/documentRequests/repository'
import type { DocumentRequest } from '@/lib/documentRequests/model'

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
  // A portal upload against one of the firm's requests: the request is marked
  // received and the document linked to it once the file is stored.
  const requestId = String(form.get('requestId') ?? '').trim() || null
  // A portal upload of an institution's confirmation for one of the client's
  // assets: the asset moves to awaiting confirmation with the document linked.
  const assetId = String(form.get('assetId') ?? '').trim() || null

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
      source: isAdmin ? 'firm' : 'client',
      shared_at: null,
      uploaded_by: user.id,
    })
    .select(MATTER_DOCUMENT_COLUMNS)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let request: DocumentRequest | null = null
  if (requestId && isUuid(requestId)) {
    // Scoped to the matter the upload was authorised for, so a request id from
    // another matter changes nothing. A request already accepted or waived is
    // left as it is; the document is still filed.
    request = await markDocumentRequestReceived({ requestId, matterId, documentId: String(data.id) })
      .catch(caught => {
        console.error('[documents] could not mark the request received', { requestId, cause: caught instanceof Error ? caught.message : String(caught) })
        return null
      })
  }

  let asset: { ok: boolean; message?: string } | null = null
  if (assetId && isUuid(assetId) && !isAdmin) {
    // Scoped to the matter the upload was authorised for; an asset already
    // confirmed, or one the firm handles itself, leaves the document filed and
    // says why nothing else changed.
    const { recordClientRetitling } = await import('@/lib/funding/portalServer')
    asset = await recordClientRetitling({ matterId, assetId, documentId: String(data.id), note: null, actorId: user.id })
      .then(result => result.ok ? { ok: true } : { ok: false, message: result.message })
      .catch(caught => {
        console.error('[documents] could not record the asset confirmation', { assetId, cause: caught instanceof Error ? caught.message : String(caught) })
        return { ok: false, message: 'The document was filed, but we could not update the asset' }
      })
  }

  return NextResponse.json({ document: data, request, asset })
}

export const runtime = 'nodejs'
