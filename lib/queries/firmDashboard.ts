import 'server-only'

import { buildFirmDashboard, type FirmDashboardSnapshot } from '@/lib/firm/dashboard'
import { fetchCrmDashboard } from '@/lib/queries/crmDashboard'
import { fetchMatterDashboard } from '@/lib/queries/matterDashboard'
import { fetchTaskCounts } from '@/lib/queries/tasks'
import type { CrmDashboardSnapshot } from '@/lib/crm/dashboard'
import type { MatterDashboardSnapshot } from '@/lib/matters/dashboard'
import { loadMatterCloseoutSummary, type MatterCloseoutSummary } from '@/lib/matters/closeout'
import type { MatterAgingTiles } from '@/lib/queries/pipelineAging'
import { reviewClient } from '@/lib/review/staff'
import type { MatterListRow } from '@/lib/queries/matters'
import { attentionRecordIds, buildRecordWorkSummaries, type RecordWorkSummary } from '@/lib/work/recordSummary'
import { fetchWorkGraphForUser } from '@/lib/work/server'

/**
 * One round of the reads the firm dashboard already trusted on the overview:
 * matter book, lead book, task counts, close-out, and the work graph that
 * decides which matters need a move. A failed task or graph read is reported
 * on its own so the rest of the book still renders.
 */
export interface FirmDashboardData {
  snapshot: FirmDashboardSnapshot
  matters: MatterDashboardSnapshot
  aging: MatterAgingTiles
  recent: MatterListRow[]
  crm: CrmDashboardSnapshot
  closeout: MatterCloseoutSummary
  workSummaries: Record<string, RecordWorkSummary>
  mattersError: string | null
  crmError: string | null
  truncated: boolean
  peopleCeiling: number
}

export async function fetchFirmDashboard(viewerId: string | null): Promise<FirmDashboardData> {
  const [tasks, matterDash, crmDash, closeout, graph] = await Promise.all([
    fetchTaskCounts(viewerId).catch(() => null),
    fetchMatterDashboard(viewerId),
    fetchCrmDashboard(viewerId),
    loadMatterCloseoutSummary(reviewClient()),
    fetchWorkGraphForUser(viewerId).catch(() => null),
  ])

  const workSummaries = graph ? buildRecordWorkSummaries(graph.items, 'matter') : {}
  const matters: MatterDashboardSnapshot = graph
    ? { ...matterDash.snapshot, needsAttention: attentionRecordIds(workSummaries).length }
    : matterDash.snapshot

  return {
    snapshot: buildFirmDashboard({
      tasks,
      matters,
      aging: matterDash.aging,
      crm: crmDash.snapshot,
    }),
    matters,
    aging: matterDash.aging,
    recent: matters.recent,
    crm: crmDash.snapshot,
    closeout,
    workSummaries,
    mattersError: matterDash.error,
    crmError: crmDash.error,
    truncated: crmDash.truncated,
    peopleCeiling: crmDash.peopleCeiling,
  }
}
