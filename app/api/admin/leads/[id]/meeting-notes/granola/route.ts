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
    const { data, error } = await admin.rpc('import_lead_granola_note_with_activity', {
      p_lead_id: id, p_title: note.title, p_meeting_date: note.meetingDate,
      p_attendees: note.attendees, p_body: note.notesMarkdown,
      p_granola_note_id: noteId, p_actor_id: userId,
    })
    if (error) {
      const status = error.code === '42501' ? 403 : error.code === 'P0002' ? 404 : 500
      return Response.json({ error: error.message }, { status })
    }
    const result = data?.[0]
    if (!result?.meeting_note) return Response.json({ error: 'Granola import returned no note' }, { status: 500 })
    return Response.json({ meetingNote: dto(result.meeting_note), imported: result.imported })
  } catch (error) {
    if (error instanceof GranolaError) {
      return Response.json({ error: error.message }, { status: error.status })
    }
    return Response.json({ error: error instanceof Error ? error.message : 'Granola import failed' }, { status: 500 })
  }
}

export const runtime = 'nodejs'
