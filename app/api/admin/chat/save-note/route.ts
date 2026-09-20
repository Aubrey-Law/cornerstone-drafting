import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/apiAuth'

interface SaveNoteBody {
  context_type?: 'matter' | 'lead'
  context_id?: string
  content?: string
  note_type?: 'internal' | 'client_comm'
}

export async function POST(req: NextRequest) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  let body: SaveNoteBody
  try {
    body = (await req.json()) as SaveNoteBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const contextType = body.context_type
  const contextId = typeof body.context_id === 'string' ? body.context_id.trim() : ''
  const content = typeof body.content === 'string' ? body.content.trim() : ''

  if (!content) {
    return NextResponse.json({ error: 'content is required' }, { status: 400 })
  }
  if (contextType !== 'matter' && contextType !== 'lead') {
    return NextResponse.json({ error: 'context_type must be matter or lead' }, { status: 400 })
  }
  if (!contextId) {
    return NextResponse.json({ error: 'context_id is required' }, { status: 400 })
  }

  const admin = getAdminClient()

  const noteType = body.note_type === 'client_comm' ? 'client_comm' : 'internal'

  if (contextType === 'lead') {
    // The same transaction the lead notes tab writes through: the note and its
    // activity row land together, and the note carries the attorney as author
    // rather than the service role.
    const { data, error } = await admin.rpc('create_lead_note_with_activity', {
      p_lead_id: contextId,
      p_body: content,
      p_actor_id: userId,
      p_note_type: noteType,
    })
    if (error) {
      const status = error.code === '42501' ? 403 : error.code === 'P0002' ? 404 : 500
      return NextResponse.json(
        { error: status === 404 ? 'Lead not found' : error.message },
        { status },
      )
    }
    return NextResponse.json({ note: data }, { status: 201 })
  }

  const { data: matter, error: matterError } = await admin
    .from('matters')
    .select('id')
    .eq('id', contextId)
    .maybeSingle()
  if (matterError) {
    return NextResponse.json({ error: matterError.message }, { status: 500 })
  }
  if (!matter) {
    return NextResponse.json({ error: 'Matter not found' }, { status: 404 })
  }

  const { data, error } = await admin
    .from('matter_notes')
    .insert({ matter_id: contextId, body: content, note_type: noteType })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ note: data }, { status: 201 })
}
