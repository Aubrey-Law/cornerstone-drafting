import fs from 'node:fs'
import path from 'node:path'
import { systemWorkflowsRoot } from '@aubrey-law/system-workflows/root'
import { parseSkillMarkdown, type ParsedSkillMarkdown, type WorkSkillType } from '@/lib/works/skill'
import { worksDb } from '@/lib/works/data'

// Bundled system-skill source tree. Each skill lives at
// tools/workflows/system/<type>/<slug>/SKILL.md; the directory name is the
// stable slug and slugify(frontmatter.name) must equal it.
//
// Resolved from the package's own location rather than process.cwd(): a second
// app in the workspace builds from its own directory and would otherwise look
// for a tools/workflows tree that only exists at the repository root.
export const SYSTEM_WORKFLOWS_ROOT = path.join(systemWorkflowsRoot, 'system')

export const SYSTEM_SKILL_TYPES: WorkSkillType[] = ['assistant', 'tabular']

export function slugifySkillName(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export interface BundledSystemSkill {
  slug: string
  type: WorkSkillType
  filePath: string
  parsed: ParsedSkillMarkdown
}

/** Read and validate a single bundled SKILL.md. Throws on any invalid skill. */
export function readBundledSystemSkill(type: WorkSkillType, slug: string): BundledSystemSkill {
  const filePath = path.join(SYSTEM_WORKFLOWS_ROOT, type, slug, 'SKILL.md')
  const raw = fs.readFileSync(filePath, 'utf8')
  const parsed = parseSkillMarkdown(raw)
  if (parsed.metadata.type !== type) {
    throw new Error(`${filePath}: frontmatter type "${parsed.metadata.type}" does not match directory "${type}"`)
  }
  if (slugifySkillName(parsed.metadata.name) !== slug) {
    throw new Error(`${filePath}: slugified name "${slugifySkillName(parsed.metadata.name)}" does not match directory slug "${slug}"`)
  }
  return { slug, type, filePath, parsed }
}

/** Walk the bundled tree and validate every skill. Throws on the first invalid one. */
export function listBundledSystemSkills(root = SYSTEM_WORKFLOWS_ROOT): BundledSystemSkill[] {
  const skills: BundledSystemSkill[] = []
  for (const type of SYSTEM_SKILL_TYPES) {
    const typeDir = path.join(root, type)
    if (!fs.existsSync(typeDir)) continue
    for (const entry of fs.readdirSync(typeDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      skills.push(readBundledSystemSkill(type, entry.name))
    }
  }
  const seen = new Set<string>()
  for (const skill of skills) {
    if (seen.has(skill.slug)) throw new Error(`Duplicate system skill slug: ${skill.slug}`)
    seen.add(skill.slug)
  }
  return skills
}

function findBundledSkillBody(slug: string): string | null {
  for (const type of SYSTEM_SKILL_TYPES) {
    const filePath = path.join(SYSTEM_WORKFLOWS_ROOT, type, slug, 'SKILL.md')
    if (!fs.existsSync(filePath)) continue
    return parseSkillMarkdown(fs.readFileSync(filePath, 'utf8')).body
  }
  return null
}

const skillBodyCache = new Map<string, { body: string; loadedAt: number }>()
const SKILL_BODY_TTL_MS = 5 * 60 * 1000

/**
 * Load a system skill's Markdown body by slug. The synced `work_skills` row is
 * the runtime source of truth (admins may re-sync edited trees); the bundled
 * SKILL.md file is the fallback so fresh environments work before any sync.
 * Template placeholders in `vars` are substituted as `{{KEY}}`.
 */
export async function loadSystemSkillBody(slug: string, vars?: Record<string, string>): Promise<string> {
  const cached = skillBodyCache.get(slug)
  let body = cached && Date.now() - cached.loadedAt < SKILL_BODY_TTL_MS ? cached.body : null

  if (body === null) {
    try {
      const { data } = await worksDb()
        .from('work_skills')
        .select('skill_md')
        .eq('slug', slug)
        .eq('is_system', true)
        .eq('is_active', true)
        .maybeSingle()
      if (data?.skill_md) body = parseSkillMarkdown(data.skill_md).body
    } catch {
      // DB unavailable (tests, missing env, pre-migration) — fall through to the bundled file.
    }
    if (body === null) body = findBundledSkillBody(slug)
    if (body === null) throw new Error(`System skill not found: ${slug}`)
    skillBodyCache.set(slug, { body, loadedAt: Date.now() })
  }

  if (!vars) return body
  return body.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key: string) => vars[key] ?? match)
}

/** Test/HMR hook — drops the in-memory skill-body cache. */
export function clearSystemSkillBodyCache() {
  skillBodyCache.clear()
}
