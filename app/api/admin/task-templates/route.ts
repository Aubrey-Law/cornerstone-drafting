import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { fetchTaskTemplates } from '@/lib/queries/tasks'
import { normalizeTemplateItems } from '@/lib/tasks/templateItems'

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

export async function POST(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const body = (await req.json().catch(() => ({}))) as CreateBody
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'A template needs a name' }, { status: 400 })

  const items = normalizeTemplateItems(body.items)
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
