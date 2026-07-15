import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { worksDb } from '@/lib/works/data'
import { parseSkillMarkdown } from '@/lib/works/skill'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  const { id } = await params
  const { data, error } = await worksDb().from('work_skills').select('*').eq('id', id).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Skill not found' }, { status: 404 })
  return NextResponse.json({ skill: data })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const db = worksDb()
  const { data: current, error: readError } = await db.from('work_skills').select('*').eq('id', id).maybeSingle()
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 })
  if (!current) return NextResponse.json({ error: 'Skill not found' }, { status: 404 })
  if (current.is_system || current.owner_id !== auth.userId) return NextResponse.json({ error: 'Only the owner can edit this skill' }, { status: 403 })
  const body = await req.json().catch(() => ({})) as { skillMd?: unknown; isActive?: unknown }
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof body.isActive === 'boolean') patch.is_active = body.isActive
  if (typeof body.skillMd === 'string') {
    try {
      const parsed = parseSkillMarkdown(body.skillMd)
      patch.name = parsed.metadata.name
      patch.description = parsed.metadata.description
      patch.version = parsed.metadata.version
      patch.skill_md = parsed.source
      patch.skill_type = parsed.metadata.type
      patch.execution_mode = parsed.metadata.execution_mode
      patch.practice = parsed.metadata.practice
      patch.jurisdictions = parsed.metadata.jurisdictions
      patch.allowed_context = parsed.metadata.allowed_context
      patch.columns_config = parsed.metadata.columns_config ?? null
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid SKILL.md' }, { status: 400 })
    }
  }
  const { data, error } = await db.from('work_skills').update(patch).eq('id', id).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ skill: data })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const db = worksDb()
  const { data: current } = await db.from('work_skills').select('owner_id, is_system').eq('id', id).maybeSingle()
  if (!current) return NextResponse.json({ error: 'Skill not found' }, { status: 404 })
  if (current.is_system || current.owner_id !== auth.userId) return NextResponse.json({ error: 'Only the owner can delete this skill' }, { status: 403 })
  const { error } = await db.from('work_skills').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
