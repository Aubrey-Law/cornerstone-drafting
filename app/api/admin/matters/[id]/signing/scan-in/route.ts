import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { isUuid } from '@/lib/queries/tasks'
import { inferContentType } from '@/lib/documentUpload'
import { isScanInMediaType, runScanIn, SCAN_IN_MAX_BYTES, SCAN_IN_MAX_FILES, SCAN_IN_MEDIA_TYPES } from '@/lib/signing/scanIn'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * POST /api/admin/matters/[id]/signing/scan-in — multipart: `files` (one or
 * more PDF, JPEG or PNG scans of executed originals), `originalsLocation`,
 * `signedOn` (YYYY-MM-DD, optional override).
 *
 * Each scan is read, filed to the matter as an executed original, and the
 * record of its execution is proposed for the attorney to confirm. The
 * response carries each file's reading and its proposal, so the Signing view
 * can show the cards at once.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: matterId } = await params
  if (!isUuid(matterId)) return NextResponse.json({ error: 'Invalid matter id' }, { status: 400 })

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid multipart body' }, { status: 400 })
  }

  const files = form.getAll('files').filter((entry): entry is File => entry instanceof File)
  if (!files.length) return NextResponse.json({ error: 'Attach at least one scan' }, { status: 400 })
  if (files.length > SCAN_IN_MAX_FILES) {
    return NextResponse.json({ error: `Attach at most ${SCAN_IN_MAX_FILES} scans at a time` }, { status: 400 })
  }
  const originalsLocation = String(form.get('originalsLocation') ?? '').trim().slice(0, 300) || null
  const signedOnRaw = String(form.get('signedOn') ?? '').trim()
  if (signedOnRaw && !/^\d{4}-\d{2}-\d{2}$/.test(signedOnRaw)) {
    return NextResponse.json({ error: 'signedOn must be YYYY-MM-DD' }, { status: 400 })
  }

  const prepared: Array<{ name: string; mediaType: 'application/pdf' | 'image/jpeg' | 'image/png'; buffer: Buffer }> = []
  for (const file of files) {
    if (file.size <= 0 || file.size > SCAN_IN_MAX_BYTES) {
      return NextResponse.json({ error: `${file.name} must be between 1 byte and ${SCAN_IN_MAX_BYTES} bytes` }, { status: 400 })
    }
    const mediaType = inferContentType(file.name, file.type)
    if (!mediaType || !isScanInMediaType(mediaType)) {
      return NextResponse.json({ error: `${file.name}: scans must be ${SCAN_IN_MEDIA_TYPES.join(', ')}` }, { status: 400 })
    }
    prepared.push({ name: file.name, mediaType, buffer: Buffer.from(await file.arrayBuffer()) })
  }

  const { data: matter, error: matterError } = await getAdminClient()
    .from('matters').select('id, status, relationship_status').eq('id', matterId).maybeSingle()
  if (matterError) return NextResponse.json({ error: matterError.message }, { status: 500 })
  if (!matter) return NextResponse.json({ error: 'Matter not found' }, { status: 404 })
  if (matter.relationship_status !== 'hired') {
    return NextResponse.json({ error: 'Executed originals belong to a hired matter', code: 'matter_not_hired' }, { status: 409 })
  }
  if (matter.status === 'closed') {
    return NextResponse.json({ error: 'Matter is closed; uploads are not permitted', code: 'matter_closed' }, { status: 409 })
  }

  try {
    const results = await runScanIn({ matterId, actorId: userId, files: prepared, originalsLocation, signedOn: signedOnRaw || null })
    return NextResponse.json({ results })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not scan in the originals' }, { status: 500 })
  }
}
