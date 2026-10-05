import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { MatterMeetingNoteError, saveMatterMeetingNote } from '@/lib/meetings/saveMatterMeetingNote'
import { scheduleMeetingFollowUp } from '@/lib/meetings/schedule'

interface MeetingNotesPayload {
  matterId: string
  title: string
  meetingDate: string
  content: string
  source?: string
  sourceUrl?: string
  attendees?: string[]
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

  let document: { id: string }
  try {
    ({ document } = await saveMatterMeetingNote({
      matterId,
      title,
      meetingDate,
      content,
      source: body.source,
      sourceUrl: body.sourceUrl,
      attendees: body.attendees,
      actorId: userId,
    }))
  } catch (error) {
    if (error instanceof MatterMeetingNoteError) {
      return NextResponse.json(
        error.code ? { error: error.message, code: error.code } : { error: error.message },
        { status: error.status },
      )
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not save meeting notes' }, { status: 500 })
  }

  // The note is saved; what the firm does about it is proposed through the
  // delegation dial once the response is on its way.
  scheduleMeetingFollowUp({ matterId, title, meetingDate, content, actorId: userId, sourceKey: document.id })

  return NextResponse.json({ document })
}

export const runtime = 'nodejs'
export const maxDuration = 60
