import type { DesignDocumentInclusions } from '@/lib/designSheetDocumentInclusions'
import {
  designPlanTypeIncludesRevocableTrust,
  planTypeDisallowsRevocableTrustDocument,
} from '@/lib/designPlanType'
import type { IntakeSnapshot } from '@/lib/queries'
import {
  DESIGN_SECTION_IDS,
  normalizeDesignSectionId,
} from '@/lib/designSheet/sectionIds'

export interface DesignSectionNavItem {
  id: string
  label: string
  applicable: boolean
}

export function getDesignSectionNavItems(args: {
  intakeSnapshot: IntakeSnapshot | null
  documentInclusions: DesignDocumentInclusions
  maritalStatus?: string | null
  spouseName?: string | null
  isJointTrust?: boolean | null
  planType?: string | null
}): DesignSectionNavItem[] {
  return getAllDesignSectionNavItems(args).filter(item => item.applicable)
}

export function getAllDesignSectionNavItems(args: {
  intakeSnapshot: IntakeSnapshot | null
  documentInclusions: DesignDocumentInclusions
  maritalStatus?: string | null
  spouseName?: string | null
  isJointTrust?: boolean | null
  planType?: string | null
}): DesignSectionNavItem[] {
  const { intakeSnapshot, documentInclusions, planType } = args
  const revocableTrustPlan = designPlanTypeIncludesRevocableTrust(planType)
  const disallowsRevocableTrust = planTypeDisallowsRevocableTrustDocument(planType)
  const revocableTrustApplicable = planType == null || planType === ''
    ? documentInclusions.trust
    : documentInclusions.trust && revocableTrustPlan && !disallowsRevocableTrust

  return [
    { id: DESIGN_SECTION_IDS.intakeReview, label: 'Intake Review', applicable: Boolean(intakeSnapshot) },
    { id: DESIGN_SECTION_IDS.clientInformation, label: 'Client Information', applicable: true },
    { id: DESIGN_SECTION_IDS.familyInformation, label: 'Family Information', applicable: true },
    { id: DESIGN_SECTION_IDS.fiduciaries, label: 'Fiduciary Role Assignment', applicable: true },
    { id: DESIGN_SECTION_IDS.estatePlanDesign, label: 'Estate Plan Design', applicable: true },
    {
      id: DESIGN_SECTION_IDS.trustDetails,
      label: 'Trust Details',
      applicable: revocableTrustApplicable,
    },
    { id: DESIGN_SECTION_IDS.willDetails, label: 'Will Details', applicable: documentInclusions.will },
    { id: DESIGN_SECTION_IDS.financialPoa, label: 'Financial Power of Attorney', applicable: documentInclusions.dpoa },
    { id: DESIGN_SECTION_IDS.healthcareDirectives, label: 'Health Care & Directives', applicable: documentInclusions.healthcare },
    {
      id: DESIGN_SECTION_IDS.assetSchedules,
      label: 'Asset Schedules',
      applicable: revocableTrustApplicable,
    },
    { id: DESIGN_SECTION_IDS.transfersAssignments, label: 'Transfers & Assignments', applicable: documentInclusions.deed },
    { id: DESIGN_SECTION_IDS.attorneyNotes, label: 'Attorney Notes', applicable: true },
  ]
}

export function isValidDesignSectionId(
  sectionId: string,
  items: DesignSectionNavItem[],
): boolean {
  const normalized = normalizeDesignSectionId(sectionId) ?? sectionId
  return items.some(item => item.id === normalized)
}

export function resolveNavSectionId(
  sectionId: string | null | undefined,
  items: DesignSectionNavItem[],
): string | null {
  const normalized = normalizeDesignSectionId(sectionId)
  if (!normalized || normalized === 'overview') return null
  return items.some(item => item.id === normalized) ? normalized : items[0]?.id ?? null
}
