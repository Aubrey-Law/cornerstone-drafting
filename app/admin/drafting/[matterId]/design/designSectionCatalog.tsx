'use client'

import type { ReactNode } from 'react'
import { Scale } from 'lucide-react'
import type { SummarySectionItem } from '@/components/guided'
import type { DesignDocumentInclusions } from '@/lib/designSheetDocumentInclusions'
import type { DesignSectionSummary } from '@/lib/designSheetReadiness'
import type { DesignSheet, MatterContact, PipelineMatter } from '@/types/database'
import type { IntakeSnapshot } from '@/lib/queries'
import { AccordionBadge, SectionPlaceholder } from './sections/shared'
import { PersonalSection } from './sections/PersonalSection'
import { FamilySection } from './sections/FamilySection'
import { PlanDesignSection } from './sections/PlanDesignSection'
import { AssetsSection } from './sections/AssetsSection'
import { GoalsSection } from './sections/GoalsSection'
import { ResiduarySection } from './sections/ResiduarySection'
import {
  DeedDocumentSection,
  DpoaDocumentSection,
  HealthCareDocumentSection,
  TrustDocumentSection,
  WillDocumentSection,
} from './sections/DocumentSections'
import { IntakeSection } from './sections/IntakeSection'

export interface DesignSectionDef {
  id: string
  title: string
  subtitle?: string
  render: () => ReactNode
  visible?: boolean
}

export interface BuildDesignSectionsArgs {
  sheet: DesignSheet
  matter: PipelineMatter
  contacts: MatterContact[]
  intakeSnapshot: IntakeSnapshot | null
  isLP: boolean
  lpDataState: {
    li_plan_coverage?: string
    li_design_sheet_data?: Record<string, unknown>
  } | null
  documentInclusions: DesignDocumentInclusions
  selectedDocKeysCount: number
  updateField: <K extends keyof DesignSheet>(field: K, value: DesignSheet[K]) => void
  updateLpPatch: (patch: Record<string, unknown>) => void
  handleAddContact: (data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
  handleUpdateContact: (id: string, data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
  handlePlanCoverageChange: (value: 'no_trust' | 'trust_included') => void
}

export function buildDesignSectionDefs(args: BuildDesignSectionsArgs): DesignSectionDef[] {
  const {
    sheet,
    matter,
    contacts,
    intakeSnapshot,
    isLP,
    lpDataState,
    documentInclusions,
    selectedDocKeysCount,
    updateField,
    updateLpPatch,
    handleAddContact,
    handleUpdateContact,
    handlePlanCoverageChange,
  } = args

  const common = {
    sheet,
    onChange: updateField,
    contacts,
    onAddContact: handleAddContact,
    onUpdateContact: handleUpdateContact,
  }

  const list: DesignSectionDef[] = []

  if (intakeSnapshot) {
    list.push({
      id: 'intake-review',
      title: 'Intake Review',
      subtitle: 'Client answers (read-only)',
      render: () => <IntakeSection intake={intakeSnapshot} />,
    })
  }

  list.push(
    {
      id: 'plan-design',
      title: 'Document Selection',
      subtitle: `${selectedDocKeysCount} document${selectedDocKeysCount === 1 ? '' : 's'} selected`,
      render: () => (
        <PlanDesignSection
          {...common}
          isLP={isLP}
          planCoverage={(lpDataState?.li_plan_coverage as 'no_trust' | 'trust_included') ?? 'no_trust'}
          onPlanCoverageChange={handlePlanCoverageChange}
        />
      ),
    },
    {
      id: 'personal',
      title: 'Family Information',
      render: () => <PersonalSection sheet={sheet} onChange={updateField} />,
    },
    {
      id: 'family',
      title: 'Children & Guardians',
      render: () => <FamilySection sheet={sheet} onChange={updateField} />,
    },
  )

  if (documentInclusions.trust) {
    list.push({
      id: 'trust',
      title: 'Living Trust Details',
      render: () => <TrustDocumentSection {...common} matter={matter} />,
    })
  }

  list.push({
    id: 'assets',
    title: 'Asset Schedules',
    render: () => <AssetsSection sheet={sheet} onChange={updateField} />,
  })

  if (documentInclusions.dpoa) {
    list.push({
      id: 'dpoa',
      title: 'Powers of Attorney',
      render: () => <DpoaDocumentSection {...common} matter={matter} />,
    })
  }

  if (documentInclusions.healthcare) {
    list.push({
      id: 'healthcare',
      title: 'Health Care & Directives',
      render: () => <HealthCareDocumentSection {...common} matter={matter} />,
    })
  }

  list.push({
    id: 'dementia-directive',
    title: 'Dementia Directive',
    subtitle: 'Planned — capture notes under Attorney Notes for now',
    render: () => (
      <SectionPlaceholder
        title="Dementia Directive"
        note="Dementia-directive preferences and instructions will be captured here in a later phase. For now, note any client wishes under Attorney Notes."
      />
    ),
  })

  if (documentInclusions.will) {
    list.push({
      id: 'will',
      title: 'Executors & Will',
      render: () => (
        <>
          <WillDocumentSection {...common} matter={matter} />
          {isLP && (
            <div className="mt-6 border-t border-border pt-6">
              <div className="mb-4 flex items-center gap-2">
                <Scale className="h-4 w-4 text-muted-foreground" />
                <span className="text-[13px] font-semibold text-foreground">Residuary Estate</span>
                <AccordionBadge variant="lp">LP</AccordionBadge>
              </div>
              <ResiduarySection
                lpData={lpDataState?.li_design_sheet_data ?? {}}
                onChange={updateLpPatch}
              />
            </div>
          )}
        </>
      ),
    })
  }

  if (documentInclusions.deed) {
    list.push({
      id: 'deed',
      title: 'Deeds',
      render: () => <DeedDocumentSection sheet={sheet} onChange={updateField} />,
    })
  }

  list.push(
    {
      id: 'transfers-assignments',
      title: 'Transfers & Assignments',
      subtitle: 'Planned',
      render: () => (
        <SectionPlaceholder
          title="Transfers & Assignments"
          note="Asset transfers to trust, beneficiary-designation changes, and assignment of personal property will be captured here in a later phase."
        />
      ),
    },
    {
      id: 'goals-notes',
      title: 'Attorney Notes',
      render: () => <GoalsSection sheet={sheet} onChange={updateField} />,
    },
  )

  return list
}

export function visibleDesignSections(sections: DesignSectionDef[]): DesignSectionDef[] {
  return sections.filter(section => section.visible !== false)
}

export function buildSummarySectionItems(
  summaries: Record<string, DesignSectionSummary>,
  documentInclusions: DesignDocumentInclusions,
  intakeSnapshot: IntakeSnapshot | null,
): SummarySectionItem[] {
  const defs: SummarySectionItem[] = []
  if (intakeSnapshot) defs.push({ id: 'intake-review', label: 'Intake Review', status: 'complete' })
  defs.push(
    { id: 'plan-design', label: 'Document Selection', status: summaries['plan-design']?.status ?? 'none' },
    { id: 'personal', label: 'Family Information', status: summaries.personal?.status ?? 'none' },
    { id: 'family', label: 'Children & Guardians', status: summaries.family?.status ?? 'none' },
  )
  if (documentInclusions.trust) {
    defs.push({ id: 'trust', label: 'Living Trust Details', status: summaries.trust?.status ?? 'none' })
  }
  defs.push({ id: 'assets', label: 'Asset Schedules', status: summaries.assets?.status ?? 'none' })
  if (documentInclusions.dpoa) {
    defs.push({ id: 'dpoa', label: 'Powers of Attorney', status: summaries.dpoa?.status ?? 'none' })
  }
  if (documentInclusions.healthcare) {
    defs.push({ id: 'healthcare', label: 'Health Care & Directives', status: summaries.healthcare?.status ?? 'none' })
  }
  defs.push({ id: 'dementia-directive', label: 'Dementia Directive', status: 'none' })
  if (documentInclusions.will) {
    defs.push({ id: 'will', label: 'Executors & Will', status: summaries.will?.status ?? 'none' })
  }
  if (documentInclusions.deed) {
    defs.push({ id: 'deed', label: 'Deeds', status: summaries.deed?.status ?? 'none' })
  }
  defs.push(
    { id: 'transfers-assignments', label: 'Transfers & Assignments', status: 'none' },
    { id: 'goals-notes', label: 'Attorney Notes', status: summaries['goals-notes']?.status ?? 'none' },
  )
  return defs
}

export function resolveDesignSectionId(
  sections: DesignSectionDef[],
  requestedId: string | null | undefined,
): string | null {
  const visible = visibleDesignSections(sections)
  if (requestedId === 'overview' || !requestedId) return null
  return visible.some(section => section.id === requestedId) ? requestedId : visible[0]?.id ?? null
}

export function designSectionHref(matterId: string, sectionId: string, embedded: boolean): string {
  if (embedded) {
    return `/admin/drafting/${matterId}?step=design&section=${sectionId}`
  }
  return `/admin/drafting/${matterId}/design/${sectionId}`
}

export function designOverviewHref(matterId: string, embedded: boolean): string {
  if (embedded) {
    return `/admin/drafting/${matterId}?step=design`
  }
  return `/admin/drafting/${matterId}/design`
}
