import type { DesignDocumentInclusions } from '@/lib/designSheetDocumentInclusions'
import type { IntakeSnapshot } from '@/lib/queries'
import {
  DESIGN_SECTION_IDS,
  normalizeDesignSectionId,
} from '@/lib/designSheet/sectionIds'

export interface DesignSectionNavItem {
  id: string
  label: string
}

export function getDesignSectionNavItems(args: {
  intakeSnapshot: IntakeSnapshot | null
  documentInclusions: DesignDocumentInclusions
  maritalStatus?: string | null
  spouseName?: string | null
  isJointTrust?: boolean | null
}): DesignSectionNavItem[] {
  const { intakeSnapshot, documentInclusions } = args
  const items: DesignSectionNavItem[] = []

  if (intakeSnapshot) {
    items.push({ id: DESIGN_SECTION_IDS.intakeReview, label: 'Intake Review' })
  }

  items.push(
    { id: DESIGN_SECTION_IDS.clientInformation, label: 'Client Information' },
    { id: DESIGN_SECTION_IDS.familyInformation, label: 'Family Information' },
    { id: DESIGN_SECTION_IDS.contactsFiduciaries, label: 'Contacts & Fiduciaries' },
    { id: DESIGN_SECTION_IDS.fiduciaries, label: 'Fiduciary Role Assignment' },
    { id: DESIGN_SECTION_IDS.estatePlanDesign, label: 'Estate Plan Design' },
  )

  if (documentInclusions.trust) {
    items.push({ id: DESIGN_SECTION_IDS.trustDetails, label: 'Trust Details' })
  }

  if (documentInclusions.will) {
    items.push({ id: DESIGN_SECTION_IDS.willDetails, label: 'Will Details' })
  }

  if (documentInclusions.dpoa) {
    items.push({ id: DESIGN_SECTION_IDS.financialPoa, label: 'Financial Power of Attorney' })
  }

  if (documentInclusions.healthcare) {
    items.push({ id: DESIGN_SECTION_IDS.healthcareDirectives, label: 'Health Care & Directives' })
  }

  if (documentInclusions.trust) {
    items.push({ id: DESIGN_SECTION_IDS.assetSchedules, label: 'Asset Schedules' })
    items.push({ id: DESIGN_SECTION_IDS.transfersAssignments, label: 'Transfers & Assignments' })
  }

  items.push({ id: DESIGN_SECTION_IDS.attorneyNotes, label: 'Attorney Notes' })

  return items
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
