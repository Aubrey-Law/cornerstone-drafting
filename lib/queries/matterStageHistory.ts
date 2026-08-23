import 'server-only'

import { getAdminClient } from '@/lib/supabaseAdmin'
import {
  buildStageTimeline,
  type MatterStageHistoryEntry,
  type MatterStageHistoryRow,
} from '@/lib/matters/stageTimeline'

/**
 * The recorded stage timeline for one matter, from `matter_stage_history`
 * (20261009000000). The stored rows are transitions; what a reader wants is
 * intervals — how long the matter actually sat in each stage — so the shaping
 * lives in `lib/matters/stageTimeline`, which the client card shares.
 */

export type { MatterStageHistoryEntry, MatterStageHistoryRow }

const HISTORY_SELECT = 'id, from_stage, to_stage, entered_at, created_at, actor_id'

/**
 * The stage timeline for a matter, oldest first. Degrades to an empty timeline
 * rather than throwing: the matter page must still render if this table is
 * unavailable, since it is supporting detail and not the record itself.
 */
export async function fetchMatterStageHistory(
  matterId: string,
): Promise<{ entries: MatterStageHistoryEntry[]; error: string | null }> {
  const admin = getAdminClient()
  const { data, error } = await admin
    .from('matter_stage_history')
    .select(HISTORY_SELECT)
    .eq('matter_id', matterId)
    .order('entered_at', { ascending: true })
    .order('id', { ascending: true })

  if (error) {
    console.warn('matter stage history unavailable:', error.message)
    return { entries: [], error: error.message }
  }

  const rows = (data ?? []) as MatterStageHistoryRow[]
  if (rows.length === 0) return { entries: [], error: null }

  const actorIds = [...new Set(rows.map(row => row.actor_id).filter((id): id is string => Boolean(id)))]
  const actorNames = new Map<string, string>()
  if (actorIds.length > 0) {
    const { data: actors, error: actorError } = await admin
      .from('users')
      .select('id, display_name, email')
      .in('id', actorIds)
    if (actorError) {
      // A missing name is cosmetic; the transition itself still reads correctly.
      console.warn('matter stage history actors unavailable:', actorError.message)
    }
    for (const actor of actors ?? []) {
      actorNames.set(
        actor.id as string,
        (actor.display_name as string | null) || (actor.email as string | null) || 'Staff member',
      )
    }
  }

  return { entries: buildStageTimeline(rows, actorNames), error: null }
}
