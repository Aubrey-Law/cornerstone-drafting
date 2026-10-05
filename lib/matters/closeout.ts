import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadCeremonyStatuses } from '@/lib/ceremony/repository'
import { executionKinds, loadExecutionMatters } from '@/lib/execution/repository'
import { loadFiduciaryOverview } from '@/lib/fiduciary/view'
import { loadFundingRows } from '@/lib/funding/repository'
import { summariseMatters } from '@/lib/funding/rollup'
import { loadUnresolvedBlockers } from '@/lib/runs/advisory'
import type { GeneratedDatabase } from '@/types/supabase'

/**
 * The close-out worklists' headline numbers, for the Matters dashboard. Each
 * one is a question the firm asks across every hired matter at once — how
 * much is still outside the trusts, whose fiduciary chain has a hole, what
 * is drafted and not yet signed, which audit blocker nobody has decided —
 * and each links to its worklist. The work itself happens on the matter.
 *
 * Each figure is read on its own and reported as null when its read fails,
 * so one broken table costs one number rather than the dashboard.
 */
export interface MatterCloseoutSummary {
  funding: { unfundedValue: number; mattersOutstanding: number } | null
  fiduciaries: { mattersWithGaps: number; mattersTracked: number } | null
  signing: { mattersToSign: number; documentsToConfirm: number } | null
  blockers: { matters: number } | null
}

const orNull = async <T>(read: () => Promise<T>): Promise<T | null> => {
  try {
    return await read()
  } catch {
    return null
  }
}

export async function loadMatterCloseoutSummary(
  client: SupabaseClient<GeneratedDatabase>,
): Promise<MatterCloseoutSummary> {
  const [funding, fiduciaries, signing, blockers] = await Promise.all([
    orNull(async () => {
      const matters = summariseMatters(await loadFundingRows(client))
      const outstanding = matters.filter(matter => !matter.summary.isComplete)
      return {
        unfundedValue: outstanding.reduce((sum, matter) => sum + matter.summary.unfundedValue, 0),
        mattersOutstanding: outstanding.length,
      }
    }),
    orNull(async () => {
      const matters = await loadFiduciaryOverview(client)
      return { mattersWithGaps: matters.filter(matter => matter.gaps > 0).length, mattersTracked: matters.length }
    }),
    orNull(async () => {
      const matters = (await loadExecutionMatters(client)).filter(matter => matter.documentNames.length > 0)
      const completed = await loadCeremonyStatuses(client, matters.map(matter => matter.matterId))
      const toSign = matters.filter(matter => completed.get(matter.matterId) !== 'completed')
      return {
        mattersToSign: toSign.length,
        documentsToConfirm: toSign.reduce((sum, matter) => sum + executionKinds(matter).unmatched.length, 0),
      }
    }),
    orNull(async () => ({ matters: (await loadUnresolvedBlockers(client)).length })),
  ])

  return { funding, fiduciaries, signing, blockers }
}
