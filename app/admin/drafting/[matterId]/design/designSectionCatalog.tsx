'use client'

import type { ReactNode } from 'react'
import { Scale } from 'lucide-react'
import type { SummarySectionItem } from '@/components/guided'
import type { DesignDocumentInclusions } from '@/lib/designSheetDocumentInclusions'
import type { DesignSectionSummary } from '@/lib/designSheetReadiness'
import {
  DESIGN_SECTION_IDS,
  normalizeDesignSectionId,
} from '@/lib/designSheet/sectionIds'
import {
  getDesignSectionNavItems,
  type DesignSectionNavItem,
} from '@/lib/designSheet/designSectionNav'
import type { DesignSheet, MatterContact, PipelineMatter } from '@/types/database'
import type { IntakeSnapshot } from '@/lib/queries'
import { AccordionBadge, SectionPlaceholder } from './sections/shared'
import { ClientInformationSection } from './sections/PersonalSection'
import { FamilySection } from './sections/FamilySection'
import { PlanDesignSection } from './sections/PlanDesignSection'
import { AssetsSection } from './sections/AssetsSection'
import { GoalsSection } from './sections/GoalsSection'
import { ResiduarySection } from './sections/ResiduarySection'
import FiduciariesSection from './sections/FiduciariesSection'
import {
  DpoaDocumentSection,
  HealthCareDocumentSection,
  TrustDetailsSection,
  WillDocumentSection,
} from './sections/DocumentSections'
import { IntakeSection } from './sections/IntakeSection'
import { ContactsFiduciariesSection } from './sections/ContactsFiduciariesSection'

export interface DesignSectionDef {
  id: string
  title: string
  subtitle?: string
  render: () => ReactNode
  visible?: boolean
}

export interface BuildDesignSectionsArgs {
  matterId: string
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
  handleRemoveContact: (id: string) => void
}

export function buildDesignSectionDefs(args: BuildDesignSectionsArgs): DesignSectionDef[] {
  const {
    matterId,
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
    handleRemoveContact,
  } = args

  const navItems = getDesignSectionNavItems({
    intakeSnapshot,
    documentInclusions,
    maritalStatus: sheet.marital_status,
    spouseName: sheet.spouse_name ?? matter.spouse_name,
    isJointTrust: sheet.is_joint,
  })

  const common = {
    sheet,
    onChange: updateField,
    contacts,
    onAddContact: handleAddContact,
    onUpdateContact: handleUpdateContact,
  }

  const docCommon = { ...common, matter }

  const renderers: Record<string, () => ReactNode> = {
    [DESIGN_SECTION_IDS.intakeReview]: () => (
      <IntakeSection intake={intakeSnapshot!} matterId={matterId} />
    ),
    [DESIGN_SECTION_IDS.clientInformation]: () => (
      <ClientInformationSection sheet={sheet} onChange={updateField} />
    ),
    [DESIGN_SECTION_IDS.familyInformation]: () => (
      <FamilySection
        sheet={sheet}
        onChange={updateField}
        contacts={contacts}
        onAddContact={handleAddContact}
        onUpdateContact={handleUpdateContact}
      />
    ),
    [DESIGN_SECTION_IDS.contactsFiduciaries]: () => (
      <ContactsFiduciariesSection
        sheet={sheet}
        onChange={updateField}
        contacts={contacts}
        matterId={matterId}
        onAddContact={handleAddContact}
        onUpdateContact={handleUpdateContact}
        onRemoveContact={handleRemoveContact}
      />
    ),
    [DESIGN_SECTION_IDS.fiduciaries]: () => (
      <FiduciariesSection
        isLP={isLP}
        sheet={sheet}
        onChange={updateField}
        lpData={lpDataState as Parameters<typeof FiduciariesSection>[0]['lpData']}
        onLpChange={(key, value) => updateLpPatch({ [key]: value })}
        contacts={contacts}
        matter={matter}
        onAddContact={handleAddContact}
        onUpdateContact={handleUpdateContact}
      />
    ),
    [DESIGN_SECTION_IDS.estatePlanDesign]: () => (
      <PlanDesignSection {...common} />
    ),
    [DESIGN_SECTION_IDS.trustDetails]: () => <TrustDetailsSection {...docCommon} scope="client" />,
    [DESIGN_SECTION_IDS.willDetails]: () => (
      <>
        <WillDocumentSection {...docCommon} />
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
    [DESIGN_SECTION_IDS.financialPoa]: () => <DpoaDocumentSection {...docCommon} />,
    [DESIGN_SECTION_IDS.healthcareDirectives]: () => <HealthCareDocumentSection {...docCommon} />,
    [DESIGN_SECTION_IDS.assetSchedules]: () => <AssetsSection sheet={sheet} onChange={updateField} />,
    [DESIGN_SECTION_IDS.transfersAssignments]: () => (
      <SectionPlaceholder
        title="Transfers & Assignments"
        note="Asset transfers to trust, beneficiary-designation changes, and assignment of personal property will be captured here in a later phase."
      />
    ),
    [DESIGN_SECTION_IDS.attorneyNotes]: () => <GoalsSection sheet={sheet} onChange={updateField} />,
  }

  const subtitles: Partial<Record<string, string>> = {
    [DESIGN_SECTION_IDS.intakeReview]: 'Client answers (read-only)',
    [DESIGN_SECTION_IDS.estatePlanDesign]: `${selectedDocKeysCount} document${selectedDocKeysCount === 1 ? '' : 's'} selected`,
    [DESIGN_SECTION_IDS.transfersAssignments]: 'Planned',
  }

  const titles: Partial<Record<string, string>> = {
    [DESIGN_SECTION_IDS.contactsFiduciaries]: 'Fiduciaries & Additional Contacts',
  }

  return navItems.map(item => ({
    id: item.id,
    title: titles[item.id] ?? item.label,
    subtitle: subtitles[item.id],
    render: renderers[item.id] ?? (() => null),
  }))
}

export function visibleDesignSections(sections: DesignSectionDef[]): DesignSectionDef[] {
  return sections.filter(section => section.visible !== false)
}

export function buildSummarySectionItems(
  summaries: Record<string, DesignSectionSummary>,
  documentInclusions: DesignDocumentInclusions,
  intakeSnapshot: IntakeSnapshot | null,
  sheet: Pick<DesignSheet, 'marital_status' | 'spouse_name' | 'is_joint'>,
  matter: Pick<PipelineMatter, 'spouse_name'>,
): SummarySectionItem[] {
  const navItems = getDesignSectionNavItems({
    intakeSnapshot,
    documentInclusions,
    maritalStatus: sheet.marital_status,
    spouseName: sheet.spouse_name ?? matter.spouse_name,
    isJointTrust: sheet.is_joint,
  })

  return navItems.map(item => ({
    id: item.id,
    label: item.label,
    status: item.id === DESIGN_SECTION_IDS.intakeReview
      ? 'complete'
      : (summaries[item.id]?.status ?? 'none'),
  }))
}

export function resolveDesignSectionId(
  sections: DesignSectionDef[],
  requestedId: string | null | undefined,
): string | null {
  const visible = visibleDesignSections(sections)
  const normalized = normalizeDesignSectionId(requestedId)
  if (normalized === 'overview' || !normalized) return null
  return visible.some(section => section.id === normalized) ? normalized : visible[0]?.id ?? null
}

export function designSectionHref(matterId: string, sectionId: string, embedded: boolean): string {
  const normalized = normalizeDesignSectionId(sectionId) ?? sectionId
  if (embedded) {
    return `/admin/drafting/${matterId}?step=design&section=${normalized}`
  }
  return `/admin/drafting/${matterId}/design/${normalized}`
}

export function designOverviewHref(matterId: string, embedded: boolean): string {
  if (embedded) {
    return `/admin/drafting/${matterId}?step=design`
  }
  return `/admin/drafting/${matterId}/design`
}

