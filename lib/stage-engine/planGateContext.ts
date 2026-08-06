import { isLegalPlanBilling } from '@/lib/billing/billingType'
import { normalizeDesignPlanType } from '@/lib/designPlanType'
import type { PlanGateContext } from '@/lib/stage-engine/stageTaskTemplates'
import type { MatterDetailsRow } from '@/types/matter-details'
import type { DesignSheet } from '@/types/database'

/**
 * Resolve the plan flags a stage-task gate reads.
 *
 * The flags are the same facts the rail's Plan flags section shows — this is
 * where they stop being decoration and start deciding which work the checklist
 * carries. Stored columns win where they exist; the design sheet supplies the
 * rest, so a matter gets a sensible checklist before anyone toggles anything.
 */
export function buildPlanGateContext(
  details: MatterDetailsRow | null | undefined,
  sheet: Partial<DesignSheet> | null | undefined,
  extras: { hasMinorChildren?: boolean | null } = {},
): PlanGateContext {
  const sheetAssets = Array.isArray(sheet?.assets) ? sheet.assets : []

  return {
    planType: normalizeDesignPlanType(sheet?.plan_type),
    flags: {
      real_estate:
        details?.ep_has_real_estate
        ?? (sheetAssets.some(asset => asset.category === 'real_property')
          || Boolean(details?.ep_deed_transfers_needed)),
      credit_shelter:
        Boolean(details?.ep_separate_trusts)
        || Boolean(sheet?.spouse_trust_name?.trim())
        || Boolean(details?.credit_shelter_provisions?.trim()),
      minor_children:
        Boolean(extras.hasMinorChildren)
        || (sheet?.children ?? []).some(child => child.is_minor),
      pets: details?.ep_has_pets
        ?? Boolean(sheet?.pet_care_option && sheet.pet_care_option !== 'omit'),
      diy_signing: details?.ep_signing_method === 'diy',
      legal_plan: isLegalPlanBilling(details?.billing_type),
    },
  }
}
