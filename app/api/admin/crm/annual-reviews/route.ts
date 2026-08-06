import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { TASK_COLUMNS } from '@/lib/queries/tasks'
import { actorFrom, logTaskActivity } from '@/lib/tasks/server'

const bodySchema = z.object({ matterId: z.string().uuid() })

export async function POST(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  if (!auth.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = bodySchema.safeParse(await req.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'A valid matter is required' }, { status: 400 })

  const admin = getAdminClient()
  const { data: matter, error: matterError } = await admin
    .from('matters')
    .select('id, relationship_status')
    .eq('id', body.data.matterId)
    .maybeSingle()
  if (matterError || !matter || matter.relationship_status !== 'hired') {
    return NextResponse.json({ error: matterError?.message ?? 'Annual reviews are available for retained clients only' }, { status: 409 })
  }

  const { data: existing } = await admin
    .from('tasks')
    .select('id')
    .eq('matter_id', matter.id)
    .ilike('title', 'Annual estate plan review')
    .in('status', ['open', 'in_progress', 'blocked'])
    .maybeSingle()
  if (existing) return NextResponse.json({ created: false, taskId: existing.id })

  const dueAt = new Date()
  dueAt.setFullYear(dueAt.getFullYear() + 1)
  const { data: task, error: taskError } = await admin
    .from('tasks')
    .insert({
      title: 'Annual estate plan review',
      description: 'Review life changes, beneficiary designations, fiduciaries, and plan documents with the client.',
      status: 'open',
      priority: 'normal',
      source: 'cadence',
      task_type: 'single',
      matter_id: matter.id,
      due_at: dueAt.toISOString(),
      assignee_id: auth.userId,
      recurrence: { every: 12, unit: 'month' },
      created_by: auth.userId,
    })
    .select(TASK_COLUMNS)
    .single()
  if (taskError) return NextResponse.json({ error: taskError.message }, { status: 500 })
  await logTaskActivity(admin, task, 'task_created', actorFrom(auth.user))
  return NextResponse.json({ created: true, taskId: task.id }, { status: 201 })
}
