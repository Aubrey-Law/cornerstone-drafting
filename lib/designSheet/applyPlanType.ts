import {
  designPlanTypeIncludesRevocableTrust,
  planTypeDisallowsRevocableTrustDocument,
  type DesignPlanType,
} from '@/lib/designPlanType'
import {
  getDocumentInclusions,
  mergeDecisionUpdates,
  setDocumentInclusion,
  setEstatePlanDesignSetup,
} from '@/lib/designSheetDocumentInclusions'
import type { DesignSheet } from '@/types/database'

type PlanTypeSheet = Pick<DesignSheet, 'plan_type' | 'decisions' | 'marital_status'> &
  Partial<Pick<DesignSheet, 'children'>>

/**
 * The same plan-type change the design sheet's Plan Type block applies:
 * store the structure, and turn the revocable-trust documents on or off when
 * the new structure requires it. `decisions` is null when that package does
 * not need to change, so a caller can leave the decision blob untouched.
 */
export function applyDesignPlanType(
  sheet: PlanTypeSheet,
  nextPlanType: DesignPlanType,
): { planType: DesignPlanType; decisions: Record<string, unknown> | null } {
  const withPlan = { ...sheet, plan_type: nextPlanType }

  if (planTypeDisallowsRevocableTrustDocument(nextPlanType)) {
    if (!getDocumentInclusions(withPlan).trust) return { planType: nextPlanType, decisions: null }
    return {
      planType: nextPlanType,
      decisions: mergeDecisionUpdates(
        withPlan,
        current => setDocumentInclusion(current, 'trust', false),
        current => setEstatePlanDesignSetup(current, { trust: false, will_title: 'last_will' }),
      ),
    }
  }

  if (designPlanTypeIncludesRevocableTrust(nextPlanType)) {
    if (getDocumentInclusions(withPlan).trust) return { planType: nextPlanType, decisions: null }
    return {
      planType: nextPlanType,
      decisions: mergeDecisionUpdates(
        withPlan,
        current => setDocumentInclusion(current, 'trust', true),
        current => setEstatePlanDesignSetup(current, { trust: true, will_title: 'pour_over_will' }),
      ),
    }
  }

  return { planType: nextPlanType, decisions: null }
}
