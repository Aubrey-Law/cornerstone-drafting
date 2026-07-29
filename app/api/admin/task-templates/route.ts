import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { fetchTaskTemplates } from '@/lib/queries/tasks'
import { TASK_PRIORITIES, type TaskPriority } from '@/lib/tasks/types'

export async function GET(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const templates = await fetchTaskTemplates()
  return NextResponse.json({ templates })
}

interface CreateBody {
  name?: unknown
  description?: unknown
  items?: unknown
}

function normalizeItems(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    const text = typeof item === 'string'
      ? item
      : typeof (item as Record<string, unknown>)?.text === 'string'
        ? ((item as Record<string, unknown>).text as string)
        : ''
    if (!text.trim()) return []
    const raw = (typeof item === 'object' && item ? item : {}) as Record<string, unknown>
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

export async function POST(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const body = (await req.json().catch(() => ({}))) as CreateBody
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'A template needs a name' }, { status: 400 })

  const items = normalizeItems(body.items)
  if (items.length === 0) {
    return NextResponse.json({ error: 'A template needs at least one task' }, { status: 400 })
  }

  const admin = getAdminClient()
  const { data, error } = await admin
    .from('task_templates')
    .insert({
      name,
      description: typeof body.description === 'string' && body.description.trim()
        ? body.description.trim()
        : null,
      items,
      created_by: auth.userId,
    })
    .select('id, name, description, items, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ template: data }, { status: 201 })
}
