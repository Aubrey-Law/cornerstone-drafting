import { getAdminClient } from '@/lib/supabaseAdmin'
import { parseSkillMarkdown, type ParsedSkillMarkdown, type WorkSkillMetadata, type WorkTableColumn } from '@/lib/works/skill'

export type WorkSkillRow = {
  id: string
  slug?: string | null
  owner_id: string | null
  name: string
  description: string
  version: string
  skill_md: string
  skill_type: 'assistant' | 'tabular'
  execution_mode: 'chat' | 'run'
  practice: string | null
  jurisdictions: string[]
  allowed_context: string[]
  columns_config: WorkTableColumn[] | null
  source: 'custom' | 'system' | 'imported'
  is_system: boolean
  is_active: boolean
  created_at: string
  updated_at: string
  is_owner?: boolean
  is_shared?: boolean
  allow_edit?: boolean
}

export function worksDb() {
  // The generated Database type is intentionally updated separately from this
  // migration; this boundary keeps the new tables isolated until regeneration.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return getAdminClient() as any
}

export function skillRowFromMarkdown(parsed: ParsedSkillMarkdown, ownerId: string, extra?: Partial<WorkSkillRow>) {
  const metadata: WorkSkillMetadata = parsed.metadata
  return {
    owner_id: ownerId,
    name: metadata.name,
    description: metadata.description,
    version: metadata.version,
    skill_md: parsed.source,
    skill_type: metadata.type,
    execution_mode: metadata.execution_mode,
    practice: metadata.practice,
    jurisdictions: metadata.jurisdictions,
    allowed_context: metadata.allowed_context,
    columns_config: metadata.columns_config ?? null,
    source: extra?.source ?? 'custom',
    is_system: extra?.is_system ?? false,
    is_active: extra?.is_active ?? true,
  }
}

export function parseStoredSkill(row: Pick<WorkSkillRow, 'skill_md'>) {
  return parseSkillMarkdown(row.skill_md)
}
