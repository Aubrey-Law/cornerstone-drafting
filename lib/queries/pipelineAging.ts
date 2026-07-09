import { getAdminClient } from '@/lib/supabaseAdmin'

export type MatterAgingHealth = 'green' | 'amber' | 'red'

export interface MatterAgingRow {
  entity: 'matter'
  id: string
  client_name: string | null
  client_email: string | null
  client_phone: string | null
  track: string
  current_stage: string
  stage_order: number
  owner: 'client' | 'attorney'
  stage_entered_at: string
  days_in_stage: number
  sla_days: number | null
  escalation_offset: number | null
  is_overdue: boolean
  needs_outreach: boolean
  health: MatterAgingHealth
  raw_health: MatterAgingHealth
  days_over_sla: number | null
  snooze_id: number | null
  snoozed_until: string | null
  snooze_reason: string | null
  is_snoozed: boolean
}

export interface MatterAgingTiles {
  active: number
  red: number
  amber: number
  green: number
  overdue: number
  snoozed: number
}

const HEALTH_RANK: Record<MatterAgingHealth, number> = { red: 0, amber: 1, green: 2 }

const AGING_SELECT =
  'entity, id, client_name, client_email, client_phone, track, current_stage, stage_order, owner, stage_entered_at, days_in_stage, sla_days, escalation_offset, is_overdue, needs_outreach, health, raw_health, days_over_sla, snooze_id, snoozed_until, snooze_reason, is_snoozed'

function sortRows(rows: MatterAgingRow[]): MatterAgingRow[] {
  return [...rows].sort((a, b) => {
    if (HEALTH_RANK[a.health] !== HEALTH_RANK[b.health]) {
      return HEALTH_RANK[a.health] - HEALTH_RANK[b.health]
    }
    const ao = a.days_over_sla ?? -Infinity
    const bo = b.days_over_sla ?? -Infinity
    if (ao !== bo) return bo - ao
    return new Date(a.stage_entered_at).getTime() - new Date(b.stage_entered_at).getTime()
  })
}

function buildTiles(rows: MatterAgingRow[]): MatterAgingTiles {
  const active = rows.filter(r => !r.is_snoozed)
  return {
    active: rows.length,
    red: active.filter(r => r.health === 'red').length,
    amber: active.filter(r => r.health === 'amber').length,
    green: active.filter(r => r.health === 'green').length,
    overdue: active.filter(r => r.is_overdue).length,
    snoozed: rows.filter(r => r.is_snoozed).length,
  }
}

function normalizeRow(row: Record<string, unknown>): MatterAgingRow {
  return {
    ...(row as unknown as MatterAgingRow),
    entity: 'matter',
    client_email: (row.client_email as string | null) ?? null,
    client_phone: (row.client_phone as string | null) ?? null,
    raw_health: (row.raw_health as MatterAgingHealth) ?? (row.health as MatterAgingHealth),
    snooze_id: (row.snooze_id as number | null) ?? null,
    snoozed_until: (row.snoozed_until as string | null) ?? null,
    snooze_reason: (row.snooze_reason as string | null) ?? null,
    is_snoozed: Boolean(row.is_snoozed),
  }
}

export async function fetchMatterAging(): Promise<{
  rows: MatterAgingRow[]
  tiles: MatterAgingTiles
}> {
  const admin = getAdminClient()
  const { data, error } = await admin.from('v_matter_aging').select(AGING_SELECT)

  if (error) {
    console.error('fetchMatterAging:', error.message)
    return { rows: [], tiles: buildTiles([]) }
  }

  const rows = sortRows((data ?? []).map(r => normalizeRow(r as Record<string, unknown>)))
  return { rows, tiles: buildTiles(rows) }
}

export async function fetchMatterAgingTiles(): Promise<MatterAgingTiles> {
  const { tiles } = await fetchMatterAging()
  return tiles
}

export interface StageSlaRow {
  stage_key: string
  track: string
  entity: 'matter'
  owner: 'client' | 'attorney'
  sla_days: number | null
  escalation_offset: number | null
  stage_order: number
}

export async function fetchStageSlaRows(): Promise<StageSlaRow[]> {
  const admin = getAdminClient()
  const { data, error } = await admin
    .from('stage_sla')
    .select('stage_key, track, entity, owner, sla_days, escalation_offset, stage_order')
    .eq('entity', 'matter')
    .order('stage_order', { ascending: true })
    .order('track', { ascending: true })

  if (error) {
    console.error('fetchStageSlaRows:', error.message)
    return []
  }
  return (data ?? []) as StageSlaRow[]
}
