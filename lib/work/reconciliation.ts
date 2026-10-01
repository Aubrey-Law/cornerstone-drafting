import type { WorkGraphResult, WorkItem } from '@/lib/work/types'

export interface WorkGraphRankDifference {
  workKey: string
  legacyBand: number
  canonicalBand: number
  legacyRank: number
  canonicalRank: number
}

export interface WorkGraphReconciliation {
  legacyCount: number
  canonicalCount: number
  mappedCount: number
  coveragePercent: number
  omittedWorkKeys: string[]
  duplicateWorkKeys: string[]
  differentlyRanked: WorkGraphRankDifference[]
  additionalCanonicalWorkKeys: string[]
}

function duplicateKeys(items: WorkItem[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const item of items) {
    if (seen.has(item.workKey)) duplicates.add(item.workKey)
    seen.add(item.workKey)
  }
  return [...duplicates].sort()
}

/**
 * Compare the canonical graph to the legacy Today sources after both have been
 * adapted into stable work keys. This deliberately reports identifiers and
 * ranks only; titles, message bodies, and legal facts never enter telemetry.
 */
export function reconcileWorkGraphs(
  legacy: WorkGraphResult,
  canonical: WorkGraphResult,
): WorkGraphReconciliation {
  const legacyByKey = new Map(legacy.items.map((item, index) => [item.workKey, { item, index }]))
  const canonicalByKey = new Map(canonical.items.map((item, index) => [item.workKey, { item, index }]))
  const omittedWorkKeys = [...legacyByKey.keys()].filter(key => !canonicalByKey.has(key)).sort()
  const additionalCanonicalWorkKeys = [...canonicalByKey.keys()].filter(key => !legacyByKey.has(key)).sort()
  const mappedKeys = [...legacyByKey.keys()].filter(key => canonicalByKey.has(key))
  const differentlyRanked = mappedKeys.flatMap(workKey => {
    const legacyEntry = legacyByKey.get(workKey)!
    const canonicalEntry = canonicalByKey.get(workKey)!
    if (
      legacyEntry.item.priorityBand === canonicalEntry.item.priorityBand
      && legacyEntry.index === canonicalEntry.index
    ) return []
    return [{
      workKey,
      legacyBand: legacyEntry.item.priorityBand,
      canonicalBand: canonicalEntry.item.priorityBand,
      legacyRank: legacyEntry.index + 1,
      canonicalRank: canonicalEntry.index + 1,
    }]
  })

  return {
    legacyCount: legacy.items.length,
    canonicalCount: canonical.items.length,
    mappedCount: mappedKeys.length,
    coveragePercent: legacy.items.length === 0
      ? 100
      : Math.round((mappedKeys.length / legacy.items.length) * 10_000) / 100,
    omittedWorkKeys,
    duplicateWorkKeys: duplicateKeys(canonical.items),
    differentlyRanked,
    additionalCanonicalWorkKeys,
  }
}
