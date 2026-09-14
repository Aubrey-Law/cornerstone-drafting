import { parseSkillMarkdown, type WorkTableColumn } from '@/lib/works/skill'

export interface WorkSkill {
  id: string
  slug?: string | null
  name: string
  description: string
  version: string
  skill_md: string
  skill_type: 'assistant' | 'tabular'
  execution_mode: 'chat' | 'run'
  practice: string | null
  jurisdictions: string[]
  columns_config?: WorkTableColumn[] | null
  is_system: boolean
  is_active: boolean
  /** The version this view was built from — sent back as the concurrency guard. */
  updated_at?: string
  is_owner?: boolean
  is_shared?: boolean
  allow_edit?: boolean
}

/** Markdown body of a stored SKILL.md (frontmatter stripped); raw text when malformed. */
export function skillBody(skillMd: string): string {
  try {
    return parseSkillMarkdown(skillMd).body
  } catch {
    return skillMd
  }
}

/** Columns for a tabular skill, from the row or parsed from the markdown. */
export function skillColumns(skill: WorkSkill): WorkTableColumn[] {
  if (skill.columns_config?.length) return skill.columns_config
  try {
    return parseSkillMarkdown(skill.skill_md).metadata.columns_config ?? []
  } catch {
    return []
  }
}
