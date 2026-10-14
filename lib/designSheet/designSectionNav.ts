import type { DesignDocumentInclusions } from '@/lib/designSheetDocumentInclusions'
import {
  designPlanTypeIncludesRevocableTrust,
  planTypeDisallowsRevocableTrustDocument,
} from '@/lib/designPlanType'
import type { IntakeSnapshot } from '@/lib/queries'
import type { DesignPlanTrack } from '@/lib/collegePrepDesign'
import type { DesignSheetLayout } from '@/lib/designSheet/sheetLayout'
import {
  DESIGN_SECTION_IDS,
  DESIGN_SHEET_GROUP_IDS,
  normalizeDesignSectionId,
  resolveDesignSheetGroupId,
  type DesignSheetGroupId,
} from '@/lib/designSheet/sectionIds'

export interface DesignSectionNavItem {
  id: string
  label: string
  applicable: boolean
}

export interface DesignSectionNavArgs {
  intakeSnapshot: IntakeSnapshot | null
  documentInclusions: DesignDocumentInclusions
  maritalStatus?: string | null
  spouseName?: string | null
  isJointTrust?: boolean | null
  planType?: string | null
  /** Which plan the sheet drafts; `college_prep` swaps the whole section list. */
  planTrack?: DesignPlanTrack | null
  /** EP and EPLP open Essential Estate Plan Design unless the attorney chose the full sheet. */
  layout?: DesignSheetLayout | null
}

export function getDesignSectionNavItems(args: DesignSectionNavArgs): DesignSectionNavItem[] {
  return getAllDesignSectionNavItems(args).filter(item => item.applicable)
}

/**
 * The College Preparation Plan drafts four documents for one student. Trust,
 * will, asset, and deed sections are not merely inapplicable here — they have no
 * counterpart in the plan at all, so they are left out of the list rather than
 * greyed out in it.
 */
function collegePrepNavItems(args: DesignSectionNavArgs): DesignSectionNavItem[] {
  const { intakeSnapshot, documentInclusions } = args
  return [
    { id: DESIGN_SECTION_IDS.intakeReview, label: 'Intake Review', applicable: Boolean(intakeSnapshot) },
    { id: DESIGN_SECTION_IDS.clientInformation, label: 'Student Information', applicable: true },
    { id: DESIGN_SECTION_IDS.fiduciaries, label: 'Agent Designations', applicable: true },
    { id: DESIGN_SECTION_IDS.collegePlan, label: 'College Preparation Plan', applicable: true },
    { id: DESIGN_SECTION_IDS.financialPoa, label: 'Financial Power of Attorney', applicable: documentInclusions.dpoa },
    { id: DESIGN_SECTION_IDS.healthcareDirectives, label: 'Health Care & Directives', applicable: documentInclusions.healthcare },
  ]
}

function essentialNavItems(): DesignSectionNavItem[] {
  return [
    { id: DESIGN_SECTION_IDS.clientInformation, label: 'Client Information', applicable: true },
    { id: DESIGN_SECTION_IDS.fiduciaries, label: 'Fiduciary Role Assignment', applicable: true },
    { id: DESIGN_SECTION_IDS.essentialEstatePlan, label: 'Estate Plan Design', applicable: true },
  ]
}

/**
 * The group a deep link or readiness blocker should open. On the essential
 * sheet, trust, powers, health care, and real property all live inside
 * Estate Plan Design.
 */
export function designGroupForLayout(
  token: string | null | undefined,
  layout: DesignSheetLayout,
): DesignSheetGroupId | null {
  const resolved = resolveDesignSheetGroupId(token)
  if (!resolved || layout !== 'essential') return resolved
  if (
    resolved === DESIGN_SHEET_GROUP_IDS.facts
    || resolved === DESIGN_SHEET_GROUP_IDS.fiduciaries
    || resolved === DESIGN_SHEET_GROUP_IDS.review
    || resolved === DESIGN_SHEET_GROUP_IDS.essentialPlan
  ) return resolved
  return DESIGN_SHEET_GROUP_IDS.essentialPlan
}

export function getAllDesignSectionNavItems(args: DesignSectionNavArgs): DesignSectionNavItem[] {
  const { intakeSnapshot, documentInclusions, planType } = args
  if (args.layout === 'essential') return essentialNavItems()
  if (args.planTrack === 'college_prep') return collegePrepNavItems(args)
  const revocableTrustPlan = designPlanTypeIncludesRevocableTrust(planType)
  const disallowsRevocableTrust = planTypeDisallowsRevocableTrustDocument(planType)
  const revocableTrustApplicable = planType == null || planType === ''
    ? documentInclusions.trust
    : documentInclusions.trust && revocableTrustPlan && !disallowsRevocableTrust

  return [
    { id: DESIGN_SECTION_IDS.intakeReview, label: 'Intake Review', applicable: Boolean(intakeSnapshot) },
    { id: DESIGN_SECTION_IDS.clientInformation, label: 'Client Information', applicable: true },
    { id: DESIGN_SECTION_IDS.fiduciaries, label: 'Fiduciary Role Assignment', applicable: true },
    { id: DESIGN_SECTION_IDS.estatePlanDesign, label: 'Estate Plan Design', applicable: true },
    {
      id: DESIGN_SECTION_IDS.trustDetails,
      label: 'Trust',
      applicable: revocableTrustApplicable,
    },
    {
      id: DESIGN_SECTION_IDS.trustProvisions,
      label: 'Trust provisions',
      applicable: revocableTrustApplicable,
    },
    {
      id: DESIGN_SECTION_IDS.assetSchedules,
      label: 'Asset Schedules',
      applicable: revocableTrustApplicable,
    },
    { id: DESIGN_SECTION_IDS.familyInformation, label: 'Last Will and Testament', applicable: documentInclusions.will },
    { id: DESIGN_SECTION_IDS.willDetails, label: 'Will Details', applicable: documentInclusions.will },
    { id: DESIGN_SECTION_IDS.financialPoa, label: 'Financial Power of Attorney', applicable: documentInclusions.dpoa },
    { id: DESIGN_SECTION_IDS.healthcareDirectives, label: 'Health Care & Directives', applicable: documentInclusions.healthcare },
    { id: DESIGN_SECTION_IDS.transfersAssignments, label: 'Transfers & Assignments', applicable: documentInclusions.deed },
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
