import { getAdminClient } from '@/lib/supabaseAdmin'

export interface StageTaskRow {
  id: number
  matter_id: string
  stage_key: string
  title: string
  task_type: 'single' | 'checklist'
  soft_due_at: string | null
  hard_due_at: string | null
  status: string
  batch_tag: string | null
  checklist: Array<{ text: string; done: boolean }>
  client_name?: string | null
}

type StageTaskDbRow = Omit<StageTaskRow, 'client_name'>

async function attachMatterClientNames(rows: StageTaskDbRow[]): Promise<StageTaskRow[]> {
  if (rows.length === 0) return []

  const admin = getAdminClient()
  const matterIds = [...new Set(rows.map(r => r.matter_id))]
  const matterNames: Record<string, string | null> = {}

  const { data: matters } = await admin
    .from('matters')
    .select('id, client_name, name')
    .in('id', matterIds)

  for (const m of matters ?? []) {
    matterNames[m.id] = m.client_name ?? m.name ?? null
  }

  return rows.map(row => ({
    ...row,
    checklist: (row.checklist ?? []) as StageTaskRow['checklist'],
    client_name: matterNames[row.matter_id] ?? null,
  }))
}

export async function fetchOpenStageTasks(): Promise<StageTaskRow[]> {
  const admin = getAdminClient()
  const { data, error } = await admin
    .from('stage_tasks')
    .select('id, matter_id, stage_key, title, task_type, soft_due_at, hard_due_at, status, batch_tag, checklist')
    .eq('status', 'open')
    .order('hard_due_at', { ascending: true })

  if (error) {
    console.error('fetchOpenStageTasks:', error.message)
    return []
  }

  return attachMatterClientNames((data ?? []) as StageTaskDbRow[])
}

export async function fetchOpenStageTasksForMatter(matterId: string): Promise<StageTaskRow[]> {
  const admin = getAdminClient()
  const { data, error } = await admin
    .from('stage_tasks')
    .select('id, matter_id, stage_key, title, task_type, soft_due_at, hard_due_at, status, batch_tag, checklist')
    .eq('matter_id', matterId)
    .eq('status', 'open')
    .order('hard_due_at', { ascending: true })

  if (error) {
    console.error('fetchOpenStageTasksForMatter:', error.message)
    return []
  }

  return attachMatterClientNames((data ?? []) as StageTaskDbRow[])
}
