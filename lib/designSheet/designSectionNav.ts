import type { DesignDocumentInclusions } from '@/lib/designSheetDocumentInclusions'
import type { IntakeSnapshot } from '@/lib/queries'

export interface DesignSectionNavItem {
  id: string
  label: string
}

export function getDesignSectionNavItems(args: {
  intakeSnapshot: IntakeSnapshot | null
  documentInclusions: DesignDocumentInclusions
}): DesignSectionNavItem[] {
  const { intakeSnapshot, documentInclusions } = args
  const items: DesignSectionNavItem[] = []

  if (intakeSnapshot) {
    items.push({ id: 'intake-review', label: 'Intake Review' })
  }

  items.push(
    { id: 'plan-design', label: 'Document Selection' },
    { id: 'personal', label: 'Family Information' },
    { id: 'family', label: 'Children & Guardians' },
  )

  if (documentInclusions.trust) {
    items.push({ id: 'trust', label: 'Living Trust Details' })
  }

  items.push({ id: 'assets', label: 'Asset Schedules' })

  if (documentInclusions.dpoa) {
    items.push({ id: 'dpoa', label: 'Powers of Attorney' })
  }

  if (documentInclusions.healthcare) {
    items.push({ id: 'healthcare', label: 'Health Care & Directives' })
  }

  items.push({ id: 'dementia-directive', label: 'Dementia Directive' })

  if (documentInclusions.will) {
    items.push({ id: 'will', label: 'Executors & Will' })
  }

  if (documentInclusions.deed) {
    items.push({ id: 'deed', label: 'Deeds' })
  }

  items.push(
    { id: 'transfers-assignments', label: 'Transfers & Assignments' },
    { id: 'goals-notes', label: 'Attorney Notes' },
  )

  return items
}

export function isValidDesignSectionId(
  sectionId: string,
  items: DesignSectionNavItem[],
): boolean {
  return items.some(item => item.id === sectionId)
}
