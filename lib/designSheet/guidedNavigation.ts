import type { DesignReadinessBlocker, DesignSectionSummary } from '@/lib/designSheetReadiness'

export function groupGuidedSections<T extends { id: string }>(
  sections: T[],
  summaries: Record<string, DesignSectionSummary>,
) {
  return sections.reduce((groups, section) => {
    const status = summaries[section.id]?.status ?? 'none'
    if (status === 'attention') groups.attention.push(section)
    else if (status === 'complete') groups.complete.push(section)
    else groups.remaining.push(section)
    return groups
  }, { attention: [] as T[], remaining: [] as T[], complete: [] as T[] })
}

export function findNextUnresolvedBlocker(
  blockers: DesignReadinessBlocker[],
  activeSectionId?: string | null,
) {
  const blocking = blockers.filter(item => item.blocking)
  if (blocking.length === 0) return null
  if (!activeSectionId) return blocking[0]
  const activeSectionEnd = blocking.findLastIndex(item => item.sectionId === activeSectionId)
  if (activeSectionEnd === -1) return blocking[0]
  return blocking.slice(activeSectionEnd + 1).find(item => item.sectionId !== activeSectionId) ?? blocking[0]
}
