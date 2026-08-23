import { getAdminClient } from '@/lib/supabaseAdmin'

export type MatterAgingHealth = 'green' | 'amber' | 'red'

export interface MatterAgingRow {
  entity: 'matter' | 'lead'
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
  /**
   * Times this row has entered its current stage, and the total business days
   * across all of them. Absent when no history is recorded yet — `days_in_stage`
   * measures only the latest visit, so these differ once a stage is re-entered.
   */
  stage_visits?: number
  stage_total_days?: number
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
    entity: row.entity === 'lead' ? 'lead' : 'matter',
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
  const { data, error } = await admin.from('v_pipeline_aging').select(AGING_SELECT)

  if (error) {
    console.error('fetchMatterAging:', error.message)
    return { rows: [], tiles: buildTiles([]) }
  }

  const rows = sortRows((data ?? []).map(r => normalizeRow(r as Record<string, unknown>)))
  return { rows: await attachStageTotals(admin, rows), tiles: buildTiles(rows) }
}

/**
 * Adds the total time each row has spent in its current stage, across every
 * visit to it.
 *
 * `stage_entered_at` resets whenever the stage changes, so the board's
 * `days_in_stage` only ever measures the latest visit. A matter cycling through
 * the revision loop therefore looks new on every return and can churn for
 * months without an SLA ever catching it. `v_matter_stage_totals`
 * (20261010000000) is the record of the earlier visits.
 *
 * Totals are supporting detail: if the view is unavailable the rows come back
 * unannotated rather than the board failing.
 */
async function attachStageTotals(
  admin: ReturnType<typeof getAdminClient>,
  rows: MatterAgingRow[],
): Promise<MatterAgingRow[]> {
  if (rows.length === 0) return rows

  const ids = [...new Set(rows.map(row => row.id))]
  const { data, error } = await admin
    .from('v_matter_stage_totals')
    .select('matter_id, client_intake_id, stage, visits, business_days')
    // Matter rows are keyed by the matter id and lead rows by the intake id —
    // `v_pipeline_aging` unions the two — so both are matched in one trip.
    .or(`matter_id.in.(${ids.join(',')}),client_intake_id.in.(${ids.join(',')})`)

  if (error) {
    console.warn('stage totals unavailable:', error.message)
    return rows
  }

  const totals = new Map<string, { visits: number; businessDays: number }>()
  for (const entry of data ?? []) {
    const record = entry as Record<string, unknown>
    const value = {
      visits: Number(record.visits) || 0,
      businessDays: Number(record.business_days) || 0,
    }
    const stage = String(record.stage ?? '')
    for (const key of [record.matter_id, record.client_intake_id]) {
      if (typeof key === 'string' && key) totals.set(`${key}:${stage}`, value)
    }
  }

  return rows.map(row => {
    const total = totals.get(`${row.id}:${row.current_stage}`)
    return total
      ? { ...row, stage_visits: total.visits, stage_total_days: total.businessDays }
      : row
  })
}

export async function fetchMatterAgingTiles(): Promise<MatterAgingTiles> {
  const { tiles } = await fetchMatterAging()
  return tiles
}

export interface StageSlaRow {
  stage_key: string
  track: string
  entity: 'matter' | 'lead'
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
    .order('entity', { ascending: true })
    .order('stage_order', { ascending: true })
    .order('track', { ascending: true })

  if (error) {
    console.error('fetchStageSlaRows:', error.message)
    return []
  }
  return (data ?? []) as StageSlaRow[]
}
