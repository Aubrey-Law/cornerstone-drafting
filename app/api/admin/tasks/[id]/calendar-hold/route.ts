import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { isUuid, TASK_COLUMNS } from '@/lib/queries/tasks'
import { createTaskCalendarHold, TaskCalendarHoldError } from '@/lib/tasks/calendarHold'
import type { TaskRow } from '@/lib/tasks/types'

type Params = { params: Promise<{ id: string }> }

interface Body {
  startAt?: unknown
  durationMinutes?: unknown
  showAsBusy?: unknown
}

export async function POST(req: Request, { params }: Params) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid task id' }, { status: 400 })

  const body = (await req.json().catch(() => ({}))) as Body
  const startAt = typeof body.startAt === 'string' ? body.startAt : ''
  const durationMinutes = typeof body.durationMinutes === 'number'
    ? Math.trunc(body.durationMinutes)
    : Number.parseInt(String(body.durationMinutes ?? ''), 10)
  if (!startAt || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return NextResponse.json({ error: 'A valid start and positive duration are required' }, { status: 400 })
  }

  const admin = getAdminClient()
  const { data, error } = await admin.from('tasks').select(TASK_COLUMNS).eq('id', id).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  const task = data as unknown as TaskRow
  if (task.status === 'done' || task.status === 'archived') {
    return NextResponse.json({ error: 'Completed or archived tasks cannot be scheduled' }, { status: 409 })
  }
  if (task.owner !== 'firm') {
    return NextResponse.json({ error: `This work is owned by ${task.owner}, not the firm` }, { status: 409 })
  }

  try {
    const hold = await createTaskCalendarHold({
      admin,
      task,
      startAt,
      durationMinutes,
      showAsBusy: body.showAsBusy !== false,
      actorId: auth.userId,
      actorEmail: auth.user?.email ?? null,
    })
    return NextResponse.json({ hold }, { status: hold.alreadyExists ? 200 : 201 })
  } catch (error) {
    if (error instanceof TaskCalendarHoldError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'Could not create calendar hold' }, { status: 500 })
  }
}
