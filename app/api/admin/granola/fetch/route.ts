import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import {
  GranolaError,
  fetchGranolaNote,
  isGranolaNoteId,
} from '@/lib/granola'

export async function POST(req: Request) {
  const { err } = await requireAdmin(req)
  if (err) return err

  let body: { noteId?: string } = {}
  try {
    body = (await req.json()) as { noteId?: string }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const noteId = (body.noteId ?? '').trim()
  if (!noteId) {
    return NextResponse.json({ error: 'noteId is required' }, { status: 400 })
  }
  if (!isGranolaNoteId(noteId)) {
    return NextResponse.json(
      { error: 'noteId must be a Granola note id (not_…). Granola web URLs use UUIDs the public API cannot accept.' },
      { status: 400 },
    )
  }

  try {
    const doc = await fetchGranolaNote(noteId)
    return NextResponse.json({
      title: doc.title,
      meetingDate: doc.meetingDate,
      content: doc.notesMarkdown,
      attendees: doc.attendees,
      sourceUrl: doc.sourceUrl,
    })
  } catch (e) {
    if (e instanceof GranolaError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[granola/fetch] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export const runtime = 'nodejs'
