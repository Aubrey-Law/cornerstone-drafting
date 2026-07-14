import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { worksDb, skillRowFromMarkdown, type WorkSkillRow } from '@/lib/works/data'
import { parseSkillMarkdown } from '@/lib/works/skill'

export async function GET(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  const url = new URL(req.url)
  const scope = url.searchParams.get('scope') ?? 'all'
  const query = url.searchParams.get('q')?.trim().toLowerCase() ?? ''
  const type = url.searchParams.get('type')
  const db = worksDb()
  const { data: owned, error } = await db.from('work_skills').select('*').or(`owner_id.eq.${auth.userId},is_system.eq.true`).order('updated_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const email = auth.user?.email?.toLowerCase() ?? ''
  let shared: WorkSkillRow[] = []
  if (email) {
    const { data: shares } = await db.from('work_skill_shares').select('skill_id, allow_edit').eq('shared_with_email', email)
    const ids = (shares ?? []).map((share: { skill_id: string }) => share.skill_id)
    if (ids.length > 0) {
      const { data } = await db.from('work_skills').select('*').in('id', ids)
      shared = (data ?? []).map((row: WorkSkillRow) => ({ ...row, is_shared: true, allow_edit: shares.find((share: { skill_id: string }) => share.skill_id === row.id)?.allow_edit ?? false }))
    }
  }
  const rows = [...(owned ?? []).map((row: WorkSkillRow) => ({ ...row, is_owner: row.owner_id === auth.userId || row.is_system })), ...shared]
    .filter((row, index, all) => all.findIndex(candidate => candidate.id === row.id) === index)
    .filter((row: WorkSkillRow) => scope === 'inactive' ? !row.is_active : scope === 'system' ? row.is_system && row.is_active : scope === 'mine' ? row.is_owner && !row.is_system && row.is_active : scope === 'shared' ? row.is_shared && row.is_active : row.is_active)
    .filter((row: WorkSkillRow) => !type || row.skill_type === type)
    .filter((row: WorkSkillRow) => !query || `${row.name} ${row.description} ${row.practice ?? ''}`.toLowerCase().includes(query))
  return NextResponse.json({ skills: rows })
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
