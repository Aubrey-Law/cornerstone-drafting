import type { DesignSheetRow } from '@/lib/draftPayload/types'

export interface FundingPlanChecklistItem {
  number: string
  action: string
  trust: string
  priority: string
}

export interface DraftPayloadFundingPlan {
  narrative: string | null
  checklist_items: FundingPlanChecklistItem[]
}

const ASSET_CATEGORY_LABELS: Record<string, string> = {
  real_property: 'Real Estate',
  financial: 'Bank Accounts',
  retirement: 'Retirement Accounts',
  life_insurance: 'Life Insurance',
  business: 'Business Interests',
  other: 'Other',
}

export function assetCategoryLabel(category: string): string {
  return ASSET_CATEGORY_LABELS[category] ?? 'Other'
}

function readFundingPlanDecision(
  designSheet: Pick<DesignSheetRow, 'decisions'> | null | undefined,
): DraftPayloadFundingPlan {
  const raw = designSheet?.decisions?.funding_plan
  if (!raw || typeof raw !== 'object') {
    return { narrative: null, checklist_items: [] }
  }

  const record = raw as Record<string, unknown>
  const narrative = typeof record.narrative === 'string' ? record.narrative.trim() : null
  const checklistRaw = Array.isArray(record.checklist_items) ? record.checklist_items : []

  const checklist_items = checklistRaw
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null
      const row = item as Record<string, unknown>
      const action = typeof row.action === 'string' ? row.action.trim() : ''
      if (!action) return null
      return {
        number: typeof row.number === 'string' ? row.number : String(index + 1),
        action,
        trust: typeof row.trust === 'string' ? row.trust : '—',
        priority: typeof row.priority === 'string' ? row.priority : 'MEDIUM',
      }
    })
    .filter((item): item is FundingPlanChecklistItem => item !== null)

  return {
    narrative: narrative || null,
    checklist_items,
  }
}

export function draftPayloadFundingPlan(
  designSheet: Pick<DesignSheetRow, 'decisions'> | null | undefined,
): DraftPayloadFundingPlan {
  return readFundingPlanDecision(designSheet)
}
