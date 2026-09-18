import fs from 'node:fs'
import { worksDb } from '@/lib/works/data'
import {
  listBundledSystemSkills,
  clearSystemSkillBodyCache,
  resolveSystemWorkflowsRoot,
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

/** Postgres 23505, however the client surfaces it. */
function isDuplicateSlug(error: { code?: string; message?: string }): boolean {
  return error.code === '23505' || /duplicate key|already exists/i.test(error.message ?? '')
}

/**
 * Upsert the bundled system-skill tree into work_skills, keyed by slug.
 * Skills whose slug disappeared from the tree are deactivated, never deleted —
 * work_runs.skill_id is ON DELETE RESTRICT and runs must keep their history.
 */
export async function syncSystemWorkflows(options: { root?: string } = {}): Promise<SystemSyncResult> {
  const bundled = options.root ? listBundledSystemSkills(options.root) : listBundledSystemSkills()
  // An empty tree is a deployment that did not trace tools/workflows into this
  // bundle, not a firm that deleted every workflow. Syncing it would deactivate
  // the whole library.
  if (bundled.length === 0) throw new Error('bundled system workflow tree not found; nothing synced')
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
      if (insertError) {
        // Two admins syncing at once race the partial unique index on slug. The
        // loser used to abort mid-loop with a raw duplicate-key 500, leaving the
        // tree half-synced. Converge on the row the winner wrote instead.
        if (!isDuplicateSlug(insertError)) throw new Error(`insert ${skill.slug}: ${insertError.message}`)
        const { error: retryError } = await db
          .from('work_skills')
          .update({ ...row, updated_at: new Date().toISOString() })
          .eq('slug', skill.slug)
          .eq('is_system', true)
        if (retryError) throw new Error(`update ${skill.slug}: ${retryError.message}`)
        result.updated.push(skill.slug)
        continue
      }
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

let bootSync: Promise<SystemSyncResult | null> | null = null

/**
 * Sync once per server process, at boot.
 *
 * The Library's Sync button was the only way the bundled tree reached
 * `work_skills`, so the rows the picker and `read_workflow` served drifted
 * behind every deploy until someone remembered to press it. Failure is logged
 * and swallowed: a sync problem must never keep the app from starting, and the
 * assistant reads bundled bodies directly anyway.
 *
 * On Vercel only the functions whose trace includes tools/workflows carry the
 * tree (the chat routes and the sync route). Any other function skips quietly
 * here; the sync happens on the first authenticated chat after a deploy.
 */
export function ensureSystemWorkflowsSynced(options: { root?: string } = {}): Promise<SystemSyncResult | null> {
  if (!bootSync) {
    const root = options.root ?? resolveSystemWorkflowsRoot()
    if (!fs.existsSync(root)) {
      console.info('[works] system workflow tree not in this bundle; boot sync skipped')
      bootSync = Promise.resolve(null)
      return bootSync
    }
    bootSync = syncSystemWorkflows(options.root ? { root } : {})
      .then(result => {
        const changed = result.created.length + result.updated.length + result.deactivated.length
        if (changed > 0) console.info('[works] system workflows synced at boot', result)
        return result
      })
      .catch(error => {
        console.error('[works] system workflow sync at boot failed', error)
        return null
      })
  }
  return bootSync
}

/** Test hook — forgets the once-per-process result. */
export function resetBootSyncForTests() {
  bootSync = null
}
