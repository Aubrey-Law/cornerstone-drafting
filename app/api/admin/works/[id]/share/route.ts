import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { worksDb } from '@/lib/works/data'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const body = await req.json().catch(() => ({})) as { email?: unknown; allowEdit?: unknown }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!email || !email.includes('@')) return NextResponse.json({ error: 'A valid email is required' }, { status: 400 })
  const db = worksDb()
  const { data: skill } = await db.from('work_skills').select('owner_id, is_system').eq('id', id).maybeSingle()
  if (!skill) return NextResponse.json({ error: 'Skill not found' }, { status: 404 })
  if (skill.is_system || skill.owner_id !== auth.userId) return NextResponse.json({ error: 'Only the owner can share this skill' }, { status: 403 })
  const { data, error } = await db.from('work_skill_shares').upsert({ skill_id: id, shared_with_email: email, allow_edit: body.allowEdit === true, created_by: auth.userId }, { onConflict: 'skill_id,shared_with_email' }).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ share: data }, { status: 201 })
}
