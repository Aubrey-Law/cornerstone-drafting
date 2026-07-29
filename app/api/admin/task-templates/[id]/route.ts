import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { isUuid } from '@/lib/queries/tasks'
import { TASK_PRIORITIES, type TaskPriority } from '@/lib/tasks/types'

type Params = { params: Promise<{ id: string }> }

interface PatchBody {
  name?: unknown
  description?: unknown
  items?: unknown
}

function normalizeItems(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    const raw = (typeof item === 'object' && item ? item : {}) as Record<string, unknown>
    const text = typeof item === 'string' ? item : typeof raw.text === 'string' ? raw.text : ''
    if (!text.trim()) return []
    const offset = Number(raw.offset_days)
    return [{
      text: text.trim(),
      offset_days: Number.isFinite(offset) ? Math.round(offset) : 0,
      priority: TASK_PRIORITIES.includes(raw.priority as TaskPriority)
        ? (raw.priority as TaskPriority)
        : 'normal',
    }]
  })
}

export async function PATCH(req: Request, { params }: Params) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid template id' }, { status: 400 })

  const body = (await req.json().catch(() => ({}))) as PatchBody
  const patch: Record<string, unknown> = {}

  if (typeof body.name === 'string') {
    const name = body.name.trim()
    if (!name) return NextResponse.json({ error: 'A template needs a name' }, { status: 400 })
    patch.name = name
  }
  if (body.description !== undefined) {
    patch.description = typeof body.description === 'string' && body.description.trim()
      ? body.description.trim()
      : null
  }
  if (body.items !== undefined) {
    const items = normalizeItems(body.items)
    if (items.length === 0) {
      return NextResponse.json({ error: 'A template needs at least one task' }, { status: 400 })
    }
    patch.items = items
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const admin = getAdminClient()
  const { data, error } = await admin
    .from('task_templates')
    .update(patch)
    .eq('id', id)
    .select('id, name, description, items, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ template: data })
}

/**
 * Archive rather than delete: tasks created from a template keep pointing at it
 * for the record tab's "Applied templates" rollup. Archiving also frees the
 * name, since the unique index only covers un-archived rows.
 */
export async function DELETE(req: Request, { params }: Params) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid template id' }, { status: 400 })

  const admin = getAdminClient()
  const { error } = await admin
    .from('task_templates')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
