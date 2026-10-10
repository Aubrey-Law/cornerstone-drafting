import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { fetchEmailTriageRow } from '@/lib/queries/emailTriage'
import { TASK_COLUMNS } from '@/lib/queries/tasks'
import { actorFrom, logTaskActivity } from '@/lib/tasks/server'
import type { TaskRow } from '@/lib/tasks/types'

export const dynamic = 'force-dynamic'

// POST /api/admin/email-triage/[id]/task — create a firm task from this thread.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) {
    return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const row = await fetchEmailTriageRow(id)
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json().catch(() => ({})) as {
    title?: unknown
    description?: unknown
    due_at?: unknown
  }

  const title = typeof body.title === 'string' && body.title.trim()
    ? body.title.trim()
    : (row.subject?.trim() || `Follow up: ${row.sender_name ?? row.sender_email}`)

  const deskLink = `/admin/email-triage?thread=${encodeURIComponent(row.id)}`
  const defaultDescription = [
    row.snippet?.trim() || null,
    `From: ${row.sender_name ? `${row.sender_name} <${row.sender_email}>` : row.sender_email}`,
    `Open in Mail Desk: ${deskLink}`,
  ].filter(Boolean).join('\n\n')

  const description = typeof body.description === 'string'
    ? body.description
    : defaultDescription

  let dueAt: string | null = null
  if (typeof body.due_at === 'string' && body.due_at) {
    const parsed = new Date(body.due_at)
    if (!Number.isNaN(parsed.getTime())) dueAt = parsed.toISOString()
  }

  const admin = getAdminClient()
  const { data, error } = await admin
    .from('tasks')
    .insert({
      title,
      description,
      priority: 'normal',
      source: 'manual',
      task_type: 'single',
      status: 'open',
      owner: 'firm',
      matter_id: row.matter_id,
      lead_id: row.client_intake_id,
      due_at: dueAt,
      assignee_id: auth.userId,
      created_by: auth.userId,
      email_triage_thread_id: row.id,
      gmail_thread_id: row.gmail_thread_id,
    })
    .select(TASK_COLUMNS)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const task = data as unknown as TaskRow
  await logTaskActivity(admin, task, 'task_created', actorFrom(auth.user))

  const href = task.matter_id
    ? `/admin/matters/${task.matter_id}?tab=tasks`
    : task.lead_id
      ? `/admin/leads/${task.lead_id}?tab=tasks`
      : '/admin/tasks'

  return NextResponse.json({ task, href }, { status: 201 })
}
