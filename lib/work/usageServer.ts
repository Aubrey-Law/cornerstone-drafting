import 'server-only'

import { firmTodayKey } from '@/lib/firmDate'
import { getAdminClient } from '@/lib/supabaseAdmin'
import type { CommandCenterUsageDay } from '@/lib/work/cutover'

export type CommandCenterUsageEvent =
  | 'command_center_opened'
  | 'legacy_today_opened'
  | 'plan_generated'
  | 'plan_replanned'
  | 'plan_committed'
  | 'plan_closed'
  | 'work_started'
  | 'work_completed'
  | 'work_snoozed'
  | 'work_blocked'

interface UsageRow {
  user_id: string
  firm_date: string
  command_center_open_count: number
  legacy_today_open_count: number
  plan_generated_count: number
  plan_replanned_count: number
  plan_committed_count: number
  plan_closed_count: number
  work_started_count: number
  work_completed_count: number
  work_snoozed_count: number
  work_blocked_count: number
  planning_seconds: number | null
  first_choice_seconds: number | null
  first_opened_at: string | null
  last_event_at: string
}

function toUsageDay(row: UsageRow): CommandCenterUsageDay {
  return {
    userId: row.user_id,
    firmDate: row.firm_date,
    commandCenterOpenCount: row.command_center_open_count,
    legacyTodayOpenCount: row.legacy_today_open_count,
    planGeneratedCount: row.plan_generated_count,
    planReplannedCount: row.plan_replanned_count,
    planCommittedCount: row.plan_committed_count,
    planClosedCount: row.plan_closed_count,
    workStartedCount: row.work_started_count,
    workCompletedCount: row.work_completed_count,
    workSnoozedCount: row.work_snoozed_count,
    workBlockedCount: row.work_blocked_count,
    planningSeconds: row.planning_seconds,
    firstChoiceSeconds: row.first_choice_seconds,
    firstOpenedAt: row.first_opened_at,
    lastEventAt: row.last_event_at,
  }
}

export async function recordCommandCenterUsage(input: {
  userId: string
  event: CommandCenterUsageEvent
  durationSeconds?: number | null
  now?: Date
}) {
  const duration = input.durationSeconds === undefined || input.durationSeconds === null
    ? null
    : Math.max(0, Math.min(86_400, Math.round(input.durationSeconds)))
  const { error } = await getAdminClient().rpc('record_command_center_usage', {
    p_user_id: input.userId,
    p_firm_date: firmTodayKey(input.now),
    p_event: input.event,
    p_duration_seconds: duration,
  })
  if (error) throw new Error(error.message)
}

export async function listCommandCenterUsage(userId: string, limit = 60): Promise<CommandCenterUsageDay[]> {
  const { data, error } = await getAdminClient()
    .from('command_center_usage_daily')
    .select('*')
    .eq('user_id', userId)
    .order('firm_date', { ascending: false })
    .limit(Math.max(10, Math.min(260, limit)))
  if (error) throw new Error(error.message)
  return ((data ?? []) as unknown as UsageRow[]).map(toUsageDay)
}

export async function recordCommandCenterUsageSafely(input: Parameters<typeof recordCommandCenterUsage>[0]) {
  try {
    await recordCommandCenterUsage(input)
  } catch (error) {
    console.error('command center usage telemetry failed', {
      event: input.event,
      cause: error instanceof Error ? error.message : 'unknown',
    })
  }
}
