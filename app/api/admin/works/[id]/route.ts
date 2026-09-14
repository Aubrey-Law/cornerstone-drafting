import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { worksDb } from '@/lib/works/data'
import { parseSkillMarkdown } from '@/lib/works/skill'

/**
 * May this attorney edit the skill?
 *
 * Ownership, or an explicit `allow_edit` share. The share flag was written by
 * the share endpoint and returned on the row, but this gate ignored it — the
 * share dialog told attorneys to grant edit "from the API", where it also did
 * nothing. Deleting stays owner-only: an edit grant is not a transfer.
 */
async function canEdit(
  db: ReturnType<typeof worksDb>,
  skill: { owner_id: string | null; is_system: boolean },
  userId: string,
  email: string | null,
): Promise<boolean> {
  if (skill.is_system) return false
  if (skill.owner_id === userId) return true
  const normalized = email?.trim().toLowerCase()
  if (!normalized) return false
  const { data: share } = await db
    .from('work_skill_shares')
    .select('allow_edit')
    .eq('skill_id', (skill as { id?: string }).id ?? '')
    .eq('shared_with_email', normalized)
    .maybeSingle()
  return share?.allow_edit === true
}

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
  if (!await canEdit(db, current, auth.userId, auth.user?.email ?? null)) {
    return NextResponse.json({ error: 'Only the owner can edit this skill' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({})) as {
    skillMd?: unknown
    isActive?: unknown
    expectedUpdatedAt?: unknown
  }
  // Optimistic concurrency, as the template and clause publishes already do:
  // without it the second of two concurrent edits silently won and the first
  // attorney's work was gone with no history to recover it from.
  const expectedUpdatedAt = typeof body.expectedUpdatedAt === 'string' ? body.expectedUpdatedAt : null
  if (expectedUpdatedAt && expectedUpdatedAt !== current.updated_at) {
    return NextResponse.json(
      { error: 'This skill changed since you opened it. Reload and reapply your edit.', currentUpdatedAt: current.updated_at },
      { status: 409 },
    )
  }
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
  // Keep the text we are about to replace. An overwrite is then recoverable
  // even though the row itself only holds the current version.
  if (typeof patch.skill_md === 'string' && patch.skill_md !== current.skill_md) {
    const { error: revisionError } = await db.from('work_skill_revisions').insert({
      skill_id: id,
      skill_md: current.skill_md,
      name: current.name,
      version: current.version,
      edited_by: auth.userId,
    })
    // History is best-effort: losing it must not block the attorney's edit.
    if (revisionError) console.error('[works] could not record skill revision', { id, error: revisionError.message })
  }

  // Scope the write to the version we read, so a racing writer loses the update
  // rather than the edit.
  let update = db.from('work_skills').update(patch).eq('id', id)
  if (expectedUpdatedAt) update = update.eq('updated_at', expectedUpdatedAt)
  const { data, error } = await update.select('*').single()
  if (error || !data) {
    if (expectedUpdatedAt) {
      return NextResponse.json(
        { error: 'This skill changed while you were saving. Reload and reapply your edit.' },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: error?.message ?? 'Unable to save this skill' }, { status: 500 })
  }
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
