import { worksDb } from '@/lib/works/data'
import {
  listBundledSystemSkills,
  clearSystemSkillBodyCache,
  type BundledSystemSkill,
} from '@/lib/works/systemSkills'

export interface SystemSyncResult {
  created: string[]
  updated: string[]
  unchanged: string[]
  deactivated: string[]
}

interface SystemSkillRow {
  id: string
  slug: string | null
  skill_md: string
  is_active: boolean
  sort_order: number | null
}

function rowFromBundledSkill(skill: BundledSystemSkill, sortOrder: number) {
  const metadata = skill.parsed.metadata
  return {
    owner_id: null,
    slug: skill.slug,
    name: metadata.name,
    description: metadata.description,
    version: metadata.version,
    skill_md: skill.parsed.source,
    skill_type: metadata.type,
    execution_mode: metadata.execution_mode,
    practice: metadata.practice,
    jurisdictions: metadata.jurisdictions,
    allowed_context: metadata.allowed_context,
    columns_config: metadata.columns_config ?? null,
    source: 'system' as const,
    is_system: true,
    is_active: true,
    sort_order: sortOrder,
  }
}

/**
 * Upsert the bundled system-skill tree into work_skills, keyed by slug.
 * Skills whose slug disappeared from the tree are deactivated, never deleted —
 * work_runs.skill_id is ON DELETE RESTRICT and runs must keep their history.
 */
export async function syncSystemWorkflows(): Promise<SystemSyncResult> {
  const bundled = listBundledSystemSkills()
  const db = worksDb()

  const { data: existingRows, error } = await db
    .from('work_skills')
    .select('id, slug, skill_md, is_active, sort_order')
    .eq('is_system', true)
  if (error) throw new Error(`work_skills query failed: ${error.message}`)

  const existingBySlug = new Map<string, SystemSkillRow>(
    ((existingRows ?? []) as SystemSkillRow[])
      .filter(row => row.slug)
      .map(row => [row.slug as string, row]),
  )

  const result: SystemSyncResult = { created: [], updated: [], unchanged: [], deactivated: [] }

  for (const [index, skill] of bundled.entries()) {
    const row = rowFromBundledSkill(skill, index)
    const existing = existingBySlug.get(skill.slug)
    if (!existing) {
      const { error: insertError } = await db.from('work_skills').insert(row)
      if (insertError) throw new Error(`insert ${skill.slug}: ${insertError.message}`)
      result.created.push(skill.slug)
    } else if (
      existing.skill_md === skill.parsed.source &&
      existing.is_active &&
      existing.sort_order === index
    ) {
      result.unchanged.push(skill.slug)
    } else {
      const { error: updateError } = await db
        .from('work_skills')
        .update({ ...row, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
      if (updateError) throw new Error(`update ${skill.slug}: ${updateError.message}`)
      result.updated.push(skill.slug)
    }
  }

  const bundledSlugs = new Set(bundled.map(skill => skill.slug))
  for (const [slug, row] of existingBySlug) {
    if (bundledSlugs.has(slug) || !row.is_active) continue
    const { error: deactivateError } = await db
      .from('work_skills')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', row.id)
    if (deactivateError) throw new Error(`deactivate ${slug}: ${deactivateError.message}`)
    result.deactivated.push(slug)
  }

  clearSystemSkillBodyCache()
  return result
}
