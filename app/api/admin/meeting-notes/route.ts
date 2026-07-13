import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/apiAuth'
import { MAX_UPLOAD_BYTES, putFileToR2, safeUploadFilename } from '@/lib/documentUpload'

interface MeetingNotesPayload {
  matterId: string
  title: string
  meetingDate: string
  content: string
  source?: string
  sourceUrl?: string
  attendees?: string[]
}

function slugifyTitle(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug.slice(0, 60) || 'notes'
}

function buildMarkdown(payload: MeetingNotesPayload): string {
  const fmEntries: Array<[string, string]> = [
    ['title', payload.title],
    ['meeting_date', payload.meetingDate],
    ['source', payload.source ?? 'granola'],
  ]
  if (payload.sourceUrl) fmEntries.push(['source_url', payload.sourceUrl])
  if (payload.attendees?.length) {
    fmEntries.push(['attendees', payload.attendees.join(', ')])
  }
  const frontmatter = fmEntries
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join('\n')

  const heading = `# ${payload.title}\n\n_${payload.meetingDate}${payload.source ? ` · ${payload.source}` : ''}_\n`
  return `---\n${frontmatter}\n---\n\n${heading}\n${payload.content.trim()}\n`
}

export async function POST(req: Request) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: MeetingNotesPayload
  try {
    body = (await req.json()) as MeetingNotesPayload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const matterId = (body.matterId ?? '').trim()
  const title = (body.title ?? '').trim()
  const meetingDate = (body.meetingDate ?? '').trim()
  const content = (body.content ?? '').trim()

  if (!matterId) return NextResponse.json({ error: 'matterId is required' }, { status: 400 })
  if (!title) return NextResponse.json({ error: 'title is required' }, { status: 400 })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meetingDate)) {
    return NextResponse.json({ error: 'meetingDate must be YYYY-MM-DD' }, { status: 400 })
  }
  if (content.length < 1) {
    return NextResponse.json({ error: 'content is required' }, { status: 400 })
  }

  const markdown = buildMarkdown({ ...body, matterId, title, meetingDate, content })
  const bytes = Buffer.from(markdown, 'utf8')
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `Note exceeds maximum size of ${MAX_UPLOAD_BYTES} bytes` },
      { status: 400 },
    )
  }

  const admin = getAdminClient()

  const { data: matter, error: matterError } = await admin
    .from('matters')
    .select('id, status, relationship_status')
    .eq('id', matterId)
    .maybeSingle()
  if (matterError) return NextResponse.json({ error: matterError.message }, { status: 500 })
  if (!matter) return NextResponse.json({ error: 'Matter not found' }, { status: 404 })
  if (matter.relationship_status !== 'hired') {
    return NextResponse.json(
      { error: 'Meeting notes are available only for hired matters', code: 'matter_not_hired' },
      { status: 409 },
    )
  }
  if (matter.status === 'closed') {
    return NextResponse.json(
      { error: 'Matter is closed; uploads are not permitted', code: 'matter_closed' },
      { status: 409 },
    )
  }

  const filename = safeUploadFilename(`${meetingDate}-${slugifyTitle(title)}.md`)
  const timestamp = Date.now()
  const r2Key = `matters/${matterId}/meeting-notes/${timestamp}-${filename}`

  try {
    await putFileToR2(r2Key, bytes, 'text/markdown')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('Meeting-notes R2 upload error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  const { data, error } = await admin
    .from('matter_documents')
    .insert({
      matter_id: matterId,
      r2_key: r2Key,
      name: filename,
      size: bytes.byteLength,
      content_type: 'text/markdown',
      folder: 'meeting-notes',
      uploaded_by: userId,
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await admin.from('matter_activity').insert({
    matter_id: matterId,
    event_type: 'document_uploaded',
    title: `Meeting notes added: ${title}`,
    detail: `Meeting on ${meetingDate}${body.source ? ` (${body.source})` : ''}`,
    metadata: {
      document_id: data.id,
      folder: 'meeting-notes',
      source: body.source ?? 'granola',
      source_url: body.sourceUrl ?? null,
      meeting_date: meetingDate,
    },
    actor_id: userId,
  })

  return NextResponse.json({ document: data })
}

export const runtime = 'nodejs'
