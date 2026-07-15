import { worksDb, type WorkSkillRow } from '@/lib/works/data'

export interface ListWorkSkillsOptions {
  scope?: string
  type?: string | null
  query?: string
}

/**
 * Owned + system + shared work skills for a user, with scope/type/text filters.
 * Shared by the works API route and the assistant's list_workflows tool.
 */
export async function listWorkSkillsForUser(
  userId: string,
  email: string | null,
  options: ListWorkSkillsOptions = {},
): Promise<WorkSkillRow[]> {
  const scope = options.scope ?? 'all'
  const query = options.query?.trim().toLowerCase() ?? ''
  const type = options.type ?? null

  const db = worksDb()
  const { data: owned, error } = await db
    .from('work_skills')
    .select('*')
    .or(`owner_id.eq.${userId},is_system.eq.true`)
    .order('updated_at', { ascending: false })
  if (error) throw new Error(error.message)

  const normalizedEmail = email?.toLowerCase() ?? ''
  let shared: WorkSkillRow[] = []
  if (normalizedEmail) {
    const { data: shares } = await db
      .from('work_skill_shares')
      .select('skill_id, allow_edit')
      .eq('shared_with_email', normalizedEmail)
    const ids = (shares ?? []).map((share: { skill_id: string }) => share.skill_id)
    if (ids.length > 0) {
      const { data } = await db.from('work_skills').select('*').in('id', ids)
      shared = (data ?? []).map((row: WorkSkillRow) => ({
        ...row,
        is_shared: true,
        allow_edit: shares.find((share: { skill_id: string }) => share.skill_id === row.id)?.allow_edit ?? false,
      }))
    }
  }

  return [...(owned ?? []).map((row: WorkSkillRow) => ({ ...row, is_owner: row.owner_id === userId || row.is_system })), ...shared]
    .filter((row: WorkSkillRow, index: number, all: WorkSkillRow[]) => all.findIndex(candidate => candidate.id === row.id) === index)
    .filter((row: WorkSkillRow) => scope === 'inactive' ? !row.is_active : scope === 'system' ? row.is_system && row.is_active : scope === 'mine' ? row.is_owner && !row.is_system && row.is_active : scope === 'shared' ? row.is_shared && row.is_active : row.is_active)
    .filter((row: WorkSkillRow) => !type || row.skill_type === type)
    .filter((row: WorkSkillRow) => !query || `${row.name} ${row.description} ${row.practice ?? ''}`.toLowerCase().includes(query))
}
