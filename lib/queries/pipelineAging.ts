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
   * across all of them, from `v_matter_stage_totals`. `days_in_stage` measures
   * only the latest visit, so these differ once a stage is re-entered.
   */
  stage_visits: number
  cumulative_days: number
  /** The cumulative budget for the stage; null disables the cumulative rule. */
  cumulative_sla_days: number | null
  /** Red because of time across visits, even when the current one is inside its SLA. */
  is_cumulative_overdue: boolean
  /**
   * A lead whose stage clock is an appointment still ahead — a booked call is
   * not a lead going stale, and before 20261015000000 every one of them sat
   * amber from the moment it was booked.
   */
  is_scheduled: boolean
  /**
   * The recorded milestone date predates the row by more than a year, so the
   * clock runs from creation instead. Surfaced rather than swallowed: one
   * typo'd year was reporting 14,864 days in stage.
   */
  stage_clock_suspect: boolean
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
  'entity, id, client_name, client_email, client_phone, track, current_stage, stage_order, owner, stage_entered_at, days_in_stage, sla_days, escalation_offset, is_overdue, needs_outreach, health, raw_health, days_over_sla, snooze_id, snoozed_until, snooze_reason, is_snoozed, stage_visits, cumulative_days, cumulative_sla_days, is_cumulative_overdue, is_scheduled, stage_clock_suspect'

/**
 * How far past its budget a row is, by whichever rule it broke.
 *
 * `days_over_sla` only measures the current visit, so a row red purely on
 * cumulative time carries a negative value — one day into a five-day stage
 * reads as −4 — and would sort below every other red row despite being the one
 * that has been churning longest.
 */
function worstOverage(row: MatterAgingRow): number {
  const perVisit = row.days_over_sla ?? -Infinity
  const cumulative =
    row.cumulative_sla_days != null && row.cumulative_days != null
      ? row.cumulative_days - row.cumulative_sla_days
      : -Infinity
  return Math.max(perVisit, cumulative)
}

function sortRows(rows: MatterAgingRow[]): MatterAgingRow[] {
  return [...rows].sort((a, b) => {
    if (HEALTH_RANK[a.health] !== HEALTH_RANK[b.health]) {
      return HEALTH_RANK[a.health] - HEALTH_RANK[b.health]
    }
    const ao = worstOverage(a)
    const bo = worstOverage(b)
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
    // A row from before the totals landed has no history, so it reads as one
    // visit lasting exactly as long as the board already shows.
    stage_visits: Number(row.stage_visits) || 1,
    cumulative_days: Number(row.cumulative_days) || Number(row.days_in_stage) || 0,
    cumulative_sla_days: (row.cumulative_sla_days as number | null) ?? null,
    is_cumulative_overdue: Boolean(row.is_cumulative_overdue),
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
    throw new Error('Matter aging is unavailable. Please retry.')
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
  entity: 'matter' | 'lead'
  owner: 'client' | 'attorney'
  sla_days: number | null
  escalation_offset: number | null
  /** Budget across every visit to the stage; null disables the cumulative rule. */
  cumulative_sla_days: number | null
  stage_order: number
}

export async function fetchStageSlaRows(): Promise<StageSlaRow[]> {
  const admin = getAdminClient()
  const { data, error } = await admin
    .from('stage_sla')
    .select('stage_key, track, entity, owner, sla_days, escalation_offset, cumulative_sla_days, stage_order')
    .order('entity', { ascending: true })
    .order('stage_order', { ascending: true })
    .order('track', { ascending: true })

  if (error) {
    console.error('fetchStageSlaRows:', error.message)
    return []
  }
  return (data ?? []) as StageSlaRow[]
}
