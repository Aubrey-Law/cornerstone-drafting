import { NextResponse } from 'next/server'
import { getBearerUser } from '@/lib/apiAuth'
import { getR2Client, R2_BUCKET } from '@/lib/r2'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { isAdminUser, userCanAccessMatter } from '@/lib/documentSecurity'
import {
  MAX_UPLOAD_BYTES,
  inferContentType,
  safeUploadFilename,
} from '@/lib/documentUpload'

// POST /api/documents/upload-url
// body: { matterId, filename, contentType, contentLength }
// returns: { uploadUrl, r2Key }
export async function POST(req: Request) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { matterId, filename, contentType, contentLength } = await req.json()
  if (!matterId || !filename || !contentType) {
    return NextResponse.json({ error: 'Missing matterId, filename, or contentType' }, { status: 400 })
  }
  const resolvedType = inferContentType(filename, contentType)
  if (!resolvedType) {
    return NextResponse.json({ error: 'File type not permitted' }, { status: 400 })
  }
  const size = Number(contentLength)
  if (!Number.isFinite(size) || size <= 0 || size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `contentLength must be a positive integer ≤ ${MAX_UPLOAD_BYTES}` },
      { status: 400 },
    )
  }

  const admin = getAdminClient()
  if (!(await userCanAccessMatter(admin, user, matterId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const source = (await isAdminUser(admin, user)) ? 'firm' : 'client'

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

  const timestamp = Date.now()
  const safeFilename = safeUploadFilename(filename)
  const r2Key = `matters/${matterId}/${source}/${timestamp}-${safeFilename}`

  const r2 = getR2Client()
  try {
    const uploadUrl = await getSignedUrl(
      r2,
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: r2Key,
        ContentType: resolvedType,
        ContentLength: size,
      }),
      { expiresIn: 300 },
    )
    return NextResponse.json({ uploadUrl, r2Key, maxBytes: size })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('R2 presign error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
