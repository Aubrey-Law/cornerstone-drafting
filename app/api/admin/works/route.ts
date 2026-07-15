import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { worksDb, skillRowFromMarkdown } from '@/lib/works/data'
import { parseSkillMarkdown } from '@/lib/works/skill'
import { listWorkSkillsForUser } from '@/lib/works/list'

export async function GET(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  try {
    const rows = await listWorkSkillsForUser(auth.userId, auth.user?.email ?? null, {
      scope: url.searchParams.get('scope') ?? 'all',
      type: url.searchParams.get('type'),
      query: url.searchParams.get('q') ?? '',
    })
    return NextResponse.json({ skills: rows })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to list skills' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as { skillMd?: unknown }
  if (typeof body.skillMd !== 'string') return NextResponse.json({ error: 'skillMd is required' }, { status: 400 })
  let parsed
  try { parsed = parseSkillMarkdown(body.skillMd) } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid SKILL.md' }, { status: 400 })
  }
  const { data, error } = await worksDb().from('work_skills').insert(skillRowFromMarkdown(parsed, auth.userId)).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ skill: data }, { status: 201 })
}
