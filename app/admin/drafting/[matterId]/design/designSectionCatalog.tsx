'use client'

import type { ReactNode } from 'react'
import { Scale } from 'lucide-react'
import {
  getDocumentInclusions,
  type DesignDocumentInclusions,
  type DesignDocumentKey,
} from '@/lib/designSheetDocumentInclusions'
import {
  designPlanTypeIncludesRevocableTrust,
  planTypeDisallowsRevocableTrustDocument,
} from '@/lib/designPlanType'
import { getDesignPlanTrack, type DesignPlanTrack } from '@/lib/collegePrepDesign'
import { normalizePracticeArea } from '@/lib/practiceArea'
import { resolveDesignSheetLayout, type DesignSheetLayout } from '@/lib/designSheet/sheetLayout'
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
import type { MatterType } from '@/lib/matter/matterType'
import type { DesignSheet, MatterContact, PipelineMatter } from '@/types/database'
import type { IntakeSnapshot } from '@/lib/queries'
import { AccordionBadge, type DesignSheetOnChange } from './sections/shared'
import { ClientInformationSection } from './sections/PersonalSection'
import { CollegePrepSection } from './sections/CollegePrepSection'
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
import { EssentialEstatePlanDesignSection } from './sections/EssentialEstatePlanDesignSection'

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

/**
 * `tracks` is which plans the tab belongs to at all. A document group is hidden
 * when that document is off, and Asset Transfer Documents (Estate Plan Details)
 * turns it back on. A College Preparation Plan has no trust tab, and an estate
 * plan has no college-prep tab.
 */
const ESSENTIAL_SHEET_GROUPS: Array<{
  id: DesignSheetGroupId
  title: string
  subtitle: string
}> = [
  { id: DESIGN_SHEET_GROUP_IDS.facts, title: 'Intake Details', subtitle: 'Client, spouse, children, and the facts the plan is built on' },
  { id: DESIGN_SHEET_GROUP_IDS.fiduciaries, title: 'Fiduciaries', subtitle: 'Trustees, personal representatives, agents, and guardians' },
  { id: DESIGN_SHEET_GROUP_IDS.essentialPlan, title: 'Estate Plan Design', subtitle: 'Plan type, beneficiaries, trust, powers, and signing' },
]

const DESIGN_SHEET_GROUP_CATALOG: Array<{
  id: DesignSheetGroupId
  title: string
  subtitle: string
  tracks: DesignPlanTrack[]
  /** Hidden when this document is off. Asset Transfer Documents turns it back on. */
  document?: DesignDocumentKey
}> = [
  { id: DESIGN_SHEET_GROUP_IDS.facts, title: 'Intake Details', subtitle: 'Client, family, and the facts the plan is built on', tracks: ['estate', 'college_prep'] },
  { id: DESIGN_SHEET_GROUP_IDS.collegePlan, title: 'College Preparation Plan', subtitle: 'School, POA scope, HIPAA, and living will', tracks: ['college_prep'] },
  { id: DESIGN_SHEET_GROUP_IDS.fiduciaries, title: 'Fiduciaries', subtitle: 'Trustees, personal representatives, agents, and guardians', tracks: ['estate', 'college_prep'] },
  { id: DESIGN_SHEET_GROUP_IDS.plan, title: 'Estate Plan Details', subtitle: 'Plan type and the documents this plan generates', tracks: ['estate'] },
  { id: DESIGN_SHEET_GROUP_IDS.trust, title: 'Trust', subtitle: 'Joint or separate, the trust name, and who receives the residue', tracks: ['estate'], document: 'trust' },
  { id: DESIGN_SHEET_GROUP_IDS.powersOfAttorney, title: 'Powers of attorney', subtitle: 'Financial authority and agent powers', tracks: ['estate', 'college_prep'], document: 'dpoa' },
  { id: DESIGN_SHEET_GROUP_IDS.healthcare, title: 'Health care', subtitle: 'Health care proxy, HIPAA, and directives', tracks: ['estate', 'college_prep'], document: 'healthcare' },
  { id: DESIGN_SHEET_GROUP_IDS.realProperty, title: 'Real property', subtitle: 'Transfers, assignments, and deed planning', tracks: ['estate'], document: 'deed' },
  { id: DESIGN_SHEET_GROUP_IDS.trustProvisions, title: 'Trust provisions', subtitle: 'Restatement, marital trusts, and administrative provisions', tracks: ['estate'], document: 'trust' },
  { id: DESIGN_SHEET_GROUP_IDS.family, title: 'Last Will and Testament', subtitle: 'Will title and legacy will details', tracks: ['estate'], document: 'will' },
  { id: DESIGN_SHEET_GROUP_IDS.notes, title: 'Attorney notes', subtitle: 'Goals, concerns, and drafting notes', tracks: ['estate', 'college_prep'] },
]

export function buildDesignSheetGroups(
  sections: DesignSectionDef[],
  planTrack: DesignPlanTrack = 'estate',
  layout: DesignSheetLayout = planTrack === 'college_prep' ? 'college_prep' : 'full',
  documentInclusions?: DesignDocumentInclusions | null,
): DesignSheetGroupDef[] {
  const catalog = layout === 'essential'
    ? ESSENTIAL_SHEET_GROUPS
    : DESIGN_SHEET_GROUP_CATALOG.filter(group => group.tracks.includes(planTrack))
      .filter(group => !documentInclusions || !group.document || documentInclusions[group.document])
      .map(({ tracks: _tracks, document: _document, ...group }) => group)
  return catalog.map(group => {
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
  onMatterTypeChange?: (value: MatterType) => void
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
    case DESIGN_SECTION_IDS.trustProvisions:
    case DESIGN_SECTION_IDS.assetSchedules:
      return revocableTrustApplicable
    case DESIGN_SECTION_IDS.willDetails:
    case DESIGN_SECTION_IDS.familyInformation:
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
    onMatterTypeChange,
    updateLpPatch,
    handleAddContact,
    handleUpdateContact,
    showInapplicable,
    fiduciaryFlashField,
  } = args

  // The plan track follows the matter's practice area; the sheet marker is kept
  // in step by reconcilePlanTrackDecisions, so either source agrees here.
  const practiceArea = normalizePracticeArea(matter.practice_area)
  const layout = resolveDesignSheetLayout({ practiceArea: matter.practice_area, sheet })

  const navArgs = {
    intakeSnapshot,
    documentInclusions,
    maritalStatus: sheet.marital_status,
    spouseName: sheet.spouse_name ?? matter.spouse_name,
    isJointTrust: sheet.is_joint,
    planType: sheet.plan_type,
    planTrack: getDesignPlanTrack(sheet),
    layout,
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
      <ClientInformationSection
        sheet={sheet}
        onChange={updateField}
        onMatterTypeChange={onMatterTypeChange}
      />
    ),
    [DESIGN_SECTION_IDS.familyInformation]: () => (
      <FamilySection
        sheet={sheet}
        onChange={updateField}
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
      <PlanDesignSection
        {...common}
        matterId={matterId}
        practiceArea={practiceArea}
        showInapplicable={Boolean(showInapplicable)}
      />
    ),
    [DESIGN_SECTION_IDS.essentialEstatePlan]: () => (
      <EssentialEstatePlanDesignSection
        {...common}
        matter={matter}
        showInapplicable={Boolean(showInapplicable)}
      />
    ),
    [DESIGN_SECTION_IDS.trustDetails]: () => <TrustDetailsSection {...docCommon} variant="plan" />,
    [DESIGN_SECTION_IDS.trustProvisions]: () => <TrustDetailsSection {...docCommon} variant="provisions" />,
    [DESIGN_SECTION_IDS.willDetails]: () => (
      <>
        <WillDocumentSection {...docCommon} />
        {isLP && (
          <div className="mt-6 border-t border-border pt-6">
            <div className="mb-4 flex items-center gap-2">
              <Scale className="h-4 w-4 text-muted-foreground" />
              <span className="text-compact font-semibold text-foreground">Residuary Estate</span>
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
    [DESIGN_SECTION_IDS.collegePlan]: () => (
      <CollegePrepSection
        {...common}
        matterId={matterId}
        practiceArea={practiceArea}
      />
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
    [DESIGN_SECTION_IDS.collegePlan]: 'School, POA scope, HIPAA, and living will',
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
