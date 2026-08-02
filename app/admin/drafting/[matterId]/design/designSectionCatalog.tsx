'use client'

import type { ReactNode } from 'react'
import { Scale } from 'lucide-react'
import {
  getDocumentInclusions,
  type DesignDocumentInclusions,
} from '@/lib/designSheetDocumentInclusions'
import {
  designPlanTypeIncludesRevocableTrust,
  planTypeDisallowsRevocableTrustDocument,
} from '@/lib/designPlanType'
import {
  DESIGN_SHEET_GROUP_IDS,
  DESIGN_SECTION_IDS,
  designSectionAnchorId,
  type DesignSheetGroupId,
} from '@/lib/designSheet/sectionIds'
import {
  getAllDesignSectionNavItems,
  getDesignSectionNavItems,
} from '@/lib/designSheet/designSectionNav'
import type { DesignSheet, MatterContact, PipelineMatter } from '@/types/database'
import type { IntakeSnapshot } from '@/lib/queries'
import { AccordionBadge, type DesignSheetOnChange } from './sections/shared'
import { ClientInformationSection } from './sections/PersonalSection'
import { FamilySection } from './sections/FamilySection'
import { PlanDesignSection } from './sections/PlanDesignSection'
import { AssetsSection } from './sections/AssetsSection'
import { GoalsSection } from './sections/GoalsSection'
import { AdditionalVariablesSection } from './sections/AdditionalVariablesSection'
import { ResiduarySection } from './sections/ResiduarySection'
import FiduciariesSection from './sections/FiduciariesSection'
import {
  DpoaDocumentSection,
  HealthCareDocumentSection,
  TrustDetailsSection,
  WillDocumentSection,
} from './sections/DocumentSections'
import { TransfersAssignmentsSection } from './sections/TransfersAssignmentsSection'

export interface DesignSectionDef {
  id: string
  title: string
  subtitle?: string
  render: () => ReactNode
  visible?: boolean
  appliesWhen?: (sheet: DesignSheet) => boolean
  applicable?: boolean
}

export interface DesignSheetGroupDef {
  id: DesignSheetGroupId
  title: string
  subtitle: string
  sections: DesignSectionDef[]
  render: () => ReactNode
}

const DESIGN_SHEET_GROUP_CATALOG: Array<{
  id: DesignSheetGroupId
  title: string
  subtitle: string
}> = [
  { id: DESIGN_SHEET_GROUP_IDS.facts, title: 'Facts from intake', subtitle: 'Client, family, and asset facts' },
  { id: DESIGN_SHEET_GROUP_IDS.family, title: 'Family', subtitle: 'Will terms and family distributions' },
  { id: DESIGN_SHEET_GROUP_IDS.fiduciaries, title: 'Fiduciaries', subtitle: 'Contacts, trustees, personal representatives, agents, and guardians' },
  { id: DESIGN_SHEET_GROUP_IDS.plan, title: 'Plan structure', subtitle: 'Plan type, documents, and execution mechanics' },
  { id: DESIGN_SHEET_GROUP_IDS.trust, title: 'Trust terms', subtitle: 'Trust structure, beneficiaries, and provisions' },
  { id: DESIGN_SHEET_GROUP_IDS.powersOfAttorney, title: 'Powers of attorney', subtitle: 'Financial authority and agent powers' },
  { id: DESIGN_SHEET_GROUP_IDS.healthcare, title: 'Health care', subtitle: 'Health care proxy, HIPAA, and directives' },
  { id: DESIGN_SHEET_GROUP_IDS.realProperty, title: 'Real property', subtitle: 'Transfers, assignments, and deed planning' },
  { id: DESIGN_SHEET_GROUP_IDS.notes, title: 'Attorney notes', subtitle: 'Goals, concerns, and drafting notes' },
]

export function buildDesignSheetGroups(sections: DesignSectionDef[]): DesignSheetGroupDef[] {
  return DESIGN_SHEET_GROUP_CATALOG.map(group => {
    const groupSections = sections.filter(section => designSectionAnchorId(section.id) === group.id)
    return {
      ...group,
      sections: groupSections,
      render: () => groupSections.length > 0
        ? groupSections.map(section => (
            <div
              key={section.id}
              id={`design-section-${section.id}`}
              className={section.applicable === false ? 'opacity-45 grayscale-[20%]' : undefined}
            >
              {section.render()}
            </div>
          ))
        : <p className="text-sm text-muted-foreground">Not included in this plan.</p>,
    }
  })
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
  updateField: DesignSheetOnChange
  updateLpPatch: (patch: Record<string, unknown>) => void
  handleAddContact: (data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
  handleUpdateContact: (id: string, data: Omit<MatterContact, 'id'>) => Promise<MatterContact>
  handleRemoveContact: (id: string) => void
  showInapplicable?: boolean
  /** Slot field a readiness blocker points at; flashes that fiduciary-grid column. */
  fiduciaryFlashField?: string | null
}

export function designSectionAppliesWhen(sectionId: string, sheet: DesignSheet): boolean {
  const inclusions = getDocumentInclusions(sheet)
  const revocableTrustPlan = designPlanTypeIncludesRevocableTrust(sheet.plan_type)
  const disallowsRevocableTrust = planTypeDisallowsRevocableTrustDocument(sheet.plan_type)
  const revocableTrustApplicable = sheet.plan_type == null || sheet.plan_type === ''
    ? inclusions.trust
    : inclusions.trust && revocableTrustPlan && !disallowsRevocableTrust
  switch (sectionId) {
    case DESIGN_SECTION_IDS.trustDetails:
    case DESIGN_SECTION_IDS.assetSchedules:
      return revocableTrustApplicable
    case DESIGN_SECTION_IDS.willDetails:
      return inclusions.will
    case DESIGN_SECTION_IDS.financialPoa:
      return inclusions.dpoa
    case DESIGN_SECTION_IDS.healthcareDirectives:
      return inclusions.healthcare
    case DESIGN_SECTION_IDS.transfersAssignments:
      return inclusions.deed
    default:
      return true
  }
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
    showInapplicable,
    fiduciaryFlashField,
  } = args

  const navArgs = {
    intakeSnapshot,
    documentInclusions,
    maritalStatus: sheet.marital_status,
    spouseName: sheet.spouse_name ?? matter.spouse_name,
    isJointTrust: sheet.is_joint,
    planType: sheet.plan_type,
  }
  const navItems = (showInapplicable === undefined
    ? getDesignSectionNavItems(navArgs)
    : getAllDesignSectionNavItems(navArgs))
    .filter(item => item.id !== DESIGN_SECTION_IDS.intakeReview)

  const common = {
    sheet,
    onChange: updateField,
    contacts,
    onAddContact: handleAddContact,
    onUpdateContact: handleUpdateContact,
  }

  const docCommon = { ...common, matter }

  const renderers: Record<string, () => ReactNode> = {
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
        showInapplicable={Boolean(showInapplicable)}
        flashRoleKey={(fiduciaryFlashField ?? null) as Parameters<typeof FiduciariesSection>[0]['flashRoleKey']}
      />
    ),
    [DESIGN_SECTION_IDS.estatePlanDesign]: () => (
      <PlanDesignSection {...common} showInapplicable={Boolean(showInapplicable)} />
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
      <TransfersAssignmentsSection
        sheet={sheet}
        onChange={updateField}
        matter={matter}
        contacts={contacts}
        onAddContact={handleAddContact}
        onUpdateContact={handleUpdateContact}
      />
    ),
    [DESIGN_SECTION_IDS.attorneyNotes]: () => (
      <>
        <GoalsSection sheet={sheet} onChange={updateField} />
        <AdditionalVariablesSection sheet={sheet} onChange={updateField} />
      </>
    ),
  }

  const subtitles: Partial<Record<string, string>> = {
    [DESIGN_SECTION_IDS.intakeReview]: 'Client answers (read-only)',
    [DESIGN_SECTION_IDS.estatePlanDesign]: `${selectedDocKeysCount} document${selectedDocKeysCount === 1 ? '' : 's'} selected`,
    [DESIGN_SECTION_IDS.transfersAssignments]: 'Deed, trustee certificate & realty trust',
  }

  return navItems
    .filter(item => item.id !== DESIGN_SECTION_IDS.intakeReview)
    .map(item => ({
    id: item.id,
    title: item.label,
    subtitle: subtitles[item.id],
    render: renderers[item.id] ?? (() => null),
    appliesWhen: currentSheet => designSectionAppliesWhen(item.id, currentSheet),
    }))
}

export function visibleDesignSections(sections: DesignSectionDef[]): DesignSectionDef[] {
  return sections.filter(section => section.visible !== false)
}
