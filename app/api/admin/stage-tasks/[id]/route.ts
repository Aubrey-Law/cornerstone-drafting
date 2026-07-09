import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'

type Params = { params: Promise<{ id: string }> }

export async function PATCH(req: Request, { params }: Params) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const { id: idParam } = await params
  const id = Number(idParam)
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'Invalid task id' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const admin = getAdminClient()

  const { data: existing, error: loadError } = await admin
    .from('stage_tasks')
    .select('id, task_type, checklist, status')
    .eq('id', id)
    .maybeSingle()

  if (loadError) return NextResponse.json({ error: loadError.message }, { status: 500 })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (body.status === 'done') {
    const checklist = (existing.checklist as Array<{ text: string; done: boolean }>) ?? []
    const { data, error } = await admin
      .from('stage_tasks')
      .update({
        status: 'done',
        checklist: checklist.map(item => ({ ...item, done: true })),
      })
      .eq('id', id)
      .select('id, matter_id, stage_key, title, task_type, soft_due_at, hard_due_at, status, batch_tag, checklist')
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ task: data })
  }

  const checklistIndex = body.checklist_index
  const done = body.done
  if (typeof checklistIndex !== 'number' || typeof done !== 'boolean') {
    return NextResponse.json({ error: 'checklist_index and done required' }, { status: 400 })
  }

  const checklist = [...((existing.checklist as Array<{ text: string; done: boolean }>) ?? [])]
  if (checklistIndex < 0 || checklistIndex >= checklist.length) {
    return NextResponse.json({ error: 'Invalid checklist index' }, { status: 400 })
  }

  checklist[checklistIndex] = { ...checklist[checklistIndex], done }
  const allDone = checklist.length > 0 && checklist.every(item => item.done)

  const { data, error } = await admin
    .from('stage_tasks')
    .update({
      checklist,
      status: allDone ? 'done' : 'open',
    })
    .eq('id', id)
    .select('id, matter_id, stage_key, title, task_type, soft_due_at, hard_due_at, status, batch_tag, checklist')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ task: data })
}
