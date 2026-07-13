import { requireAdmin } from '@/lib/apiAuth'
import { fetchGranolaNote, GranolaError, isGranolaNoteId } from '@/lib/granola'
import { getAdminClient } from '@/lib/supabaseAdmin'

interface LeadMeetingNoteRow {
  id: string
  title: string
  meeting_date: string
  attendees: string[]
  body: string
  source: string
  granola_note_id: string | null
  actor_id: string
  created_at: string
  updated_at: string
}

const dto = (row: LeadMeetingNoteRow) => ({
  id: row.id, title: row.title, date: row.meeting_date, attendees: row.attendees,
  body: row.body, source: row.source, granolaNoteId: row.granola_note_id,
  actorId: row.actor_id, createdAt: row.created_at, updatedAt: row.updated_at,
})

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err
  const { id } = await params
  const body = await req.json().catch(() => null)
  const noteId = typeof body?.noteId === 'string' ? body.noteId.trim() : ''
  if (!noteId || !isGranolaNoteId(noteId)) {
    return Response.json({ error: 'A valid Granola note id is required' }, { status: 400 })
  }

  try {
    const note = await fetchGranolaNote(noteId)
    const admin = getAdminClient()
    const { data, error } = await admin.from('lead_meeting_notes').insert({
      lead_id: id, title: note.title, meeting_date: note.meetingDate,
      attendees: note.attendees, body: note.notesMarkdown, source: 'granola',
      granola_note_id: noteId, actor_id: userId,
    }).select().single()

    if (error?.code === '23505') {
      const { data: existing, error: existingError } = await admin.from('lead_meeting_notes')
        .select('*').eq('lead_id', id).eq('granola_note_id', noteId).maybeSingle()
      if (existingError || !existing) {
        return Response.json({ error: existingError?.message ?? 'Imported note not found' }, { status: 500 })
      }
      return Response.json({ meetingNote: dto(existing), imported: false })
    }
    if (error) return Response.json({ error: error.message }, { status: 500 })

    const { error: activityError } = await admin.from('lead_activity').insert({
      lead_id: id, event_type: 'meeting_note_added', title: 'Granola meeting note imported',
      detail: note.title, actor_id: userId,
    })
    if (activityError) return Response.json({ error: activityError.message }, { status: 500 })
    return Response.json({ meetingNote: dto(data), imported: true })
  } catch (error) {
    if (error instanceof GranolaError) {
      return Response.json({ error: error.message }, { status: error.status })
    }
    return Response.json({ error: error instanceof Error ? error.message : 'Granola import failed' }, { status: 500 })
  }
}

export const runtime = 'nodejs'
