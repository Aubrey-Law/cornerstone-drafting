import { getAdminClient } from '@/lib/supabaseAdmin'
import { MAX_UPLOAD_BYTES, putFileToR2, safeUploadFilename } from '@/lib/documentUpload'

/**
 * The one way a meeting note lands on a matter: a markdown document with
 * frontmatter under the matter's `meeting-notes` folder in R2, a
 * `matter_documents` row with the `meeting-notes` source, and an activity
 * entry. The manual dialog and the transcript sweep both come through here.
 */

export interface MatterMeetingNoteInput {
  matterId: string
  title: string
  /** YYYY-MM-DD */
  meetingDate: string
  content: string
  source?: string
  sourceUrl?: string
  attendees?: string[]
  /** Who saved it; the sweep passes the firm's unattended actor. */
  actorId: string
}

export class MatterMeetingNoteError extends Error {
  status: number
  code: string | null
  constructor(status: number, message: string, code: string | null = null) {
    super(message)
    this.name = 'MatterMeetingNoteError'
    this.status = status
    this.code = code
  }
}

export function slugifyMeetingTitle(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug.slice(0, 60) || 'notes'
}

export function buildMeetingNoteMarkdown(payload: Omit<MatterMeetingNoteInput, 'actorId'>): string {
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

export async function saveMatterMeetingNote(input: MatterMeetingNoteInput): Promise<{ document: Record<string, unknown> & { id: string } }> {
  const markdown = buildMeetingNoteMarkdown(input)
  const bytes = Buffer.from(markdown, 'utf8')
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new MatterMeetingNoteError(400, `Note exceeds maximum size of ${MAX_UPLOAD_BYTES} bytes`)
  }

  const admin = getAdminClient()
  const { data: matter, error: matterError } = await admin
    .from('matters')
    .select('id, status, relationship_status')
    .eq('id', input.matterId)
    .maybeSingle()
  if (matterError) throw new MatterMeetingNoteError(500, matterError.message)
  if (!matter) throw new MatterMeetingNoteError(404, 'Matter not found')
  if (matter.relationship_status !== 'hired') {
    throw new MatterMeetingNoteError(409, 'Meeting notes are available only for hired matters', 'matter_not_hired')
  }
  if (matter.status === 'closed') {
    throw new MatterMeetingNoteError(409, 'Matter is closed; uploads are not permitted', 'matter_closed')
  }

  const filename = safeUploadFilename(`${input.meetingDate}-${slugifyMeetingTitle(input.title)}.md`)
  const r2Key = `matters/${input.matterId}/meeting-notes/${Date.now()}-${filename}`

  try {
    await putFileToR2(r2Key, bytes, 'text/markdown')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('Meeting-notes R2 upload error:', msg)
    throw new MatterMeetingNoteError(500, msg)
  }

  const { data, error } = await admin
    .from('matter_documents')
    .insert({
      matter_id: input.matterId,
      r2_key: r2Key,
      name: filename,
      size: bytes.byteLength,
      content_type: 'text/markdown',
      source: 'meeting-notes',
      shared_at: null,
      uploaded_by: input.actorId,
    })
    .select('*')
    .single()
  if (error) throw new MatterMeetingNoteError(500, error.message)

  await admin.from('matter_activity').insert({
    matter_id: input.matterId,
    event_type: 'document_uploaded',
    title: `Meeting notes added: ${input.title}`,
    detail: `Meeting on ${input.meetingDate}${input.source ? ` (${input.source})` : ''}`,
    metadata: {
      document_id: data.id,
      source: input.source ?? 'granola',
      source_url: input.sourceUrl ?? null,
      meeting_date: input.meetingDate,
    },
    actor_id: input.actorId,
  })

  return { document: data as Record<string, unknown> & { id: string } }
}
