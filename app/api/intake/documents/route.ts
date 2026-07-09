import { NextResponse } from 'next/server'
import { consumeRateLimit } from '@/lib/rateLimit'
import {
  ALLOWED_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  inferContentType,
  putFileToR2,
  safeUploadFilename,
} from '@/lib/documentUpload'
import { INTAKE_DOCUMENT_COLUMNS, type IntakeDocumentKind } from '@/lib/intake/intakeDocumentColumns'
import { resolveIntakeUploadAccess } from '@/lib/intake/resolveIntakeUploadAccess'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PER_INTAKE_FILE_CAP = 20
const VALID_KINDS = new Set<IntakeDocumentKind>([
  'general',
  'existing_plan',
  'divorce_settlement',
  'gift_tax_return',
])

const RATE_LIMIT_CFG = {
  bucket: 'intake_doc_upload',
  limit: 10,
  windowSeconds: 60 * 10,
}

function parseKind(raw: FormDataEntryValue | null): IntakeDocumentKind {
  const kind = typeof raw === 'string' ? raw.trim() : ''
  if (VALID_KINDS.has(kind as IntakeDocumentKind)) return kind as IntakeDocumentKind
  return 'general'
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const intakeId = url.searchParams.get('intakeId')?.trim() ?? ''
  const kind = url.searchParams.get('kind')?.trim()

  if (!intakeId) {
    return NextResponse.json({ error: 'Missing intakeId' }, { status: 400 })
  }

  const access = await resolveIntakeUploadAccess(req, intakeId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  let query = access.admin
    .from('intake_documents')
    .select(INTAKE_DOCUMENT_COLUMNS)
    .eq('client_intake_id', intakeId)
    .order('created_at', { ascending: false })

  if (kind && VALID_KINDS.has(kind as IntakeDocumentKind)) {
    query = query.eq('kind', kind)
  }

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ documents: data ?? [] })
}

export async function POST(req: Request) {
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid multipart body' }, { status: 400 })
  }

  const intakeId = String(form.get('intakeId') ?? '').trim()
  const file = form.get('file')
  const kind = parseKind(form.get('kind'))

  if (!intakeId) {
    return NextResponse.json({ error: 'Missing intakeId' }, { status: 400 })
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing file' }, { status: 400 })
  }

  const access = await resolveIntakeUploadAccess(req, intakeId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const rl = await consumeRateLimit(RATE_LIMIT_CFG, intakeId)
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }

  if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'File too large' }, { status: 413 })
  }

  const contentType = inferContentType(file.name, file.type)
  if (!contentType || !(ALLOWED_MIME_TYPES as readonly string[]).includes(contentType)) {
    return NextResponse.json({ error: 'Unsupported file type' }, { status: 415 })
  }

  const { count } = await access.admin
    .from('intake_documents')
    .select('id', { count: 'exact', head: true })
    .eq('client_intake_id', intakeId)

  if ((count ?? 0) >= PER_INTAKE_FILE_CAP) {
    return NextResponse.json({ error: 'Upload limit reached' }, { status: 409 })
  }

  const timestamp = Date.now()
  const safeFilename = safeUploadFilename(file.name)
  const r2Key = `intakes/${intakeId}/${kind}/${timestamp}-${safeFilename}`

  try {
    const bytes = Buffer.from(await file.arrayBuffer())
    await putFileToR2(r2Key, bytes, contentType)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('intake upload R2 error:', msg)
    return NextResponse.json({ error: 'Storage error' }, { status: 500 })
  }

  const { data, error } = await access.admin
    .from('intake_documents')
    .insert({
      client_intake_id: intakeId,
      r2_key: r2Key,
      name: file.name,
      size: file.size,
      content_type: contentType,
      kind,
      uploaded_by: access.user?.id ?? null,
    })
    .select(INTAKE_DOCUMENT_COLUMNS)
    .single()

  if (error || !data) {
    console.error('intake upload insert error:', error)
    return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })
  }

  return NextResponse.json({ document: data }, { status: 201 })
}
