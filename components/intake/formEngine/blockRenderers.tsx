'use client'

import type { ComponentType } from 'react'
import {
  ContactAddressFields,
} from '@/components/intake/IntakeFormPrimitives'
import { SpouseDetailsBlock } from '@/components/intake/IntakeFamilySteps'
import { ChildrenBlock } from '@/components/intake/IntakeChildrenStep'
import {
  AdditionalContactsBlock,
  ClientFiduciariesBlock,
  ExistingDocumentUploadsBlock,
  FinancialAssetsBlock,
  GuardianBlock,
  PlanningObjectivesBlock,
  SpouseFiduciariesBlock,
  type StepProps,
} from '@/components/intake/IntakeWizard'
import { IntakeQuestionnaireReview } from '@/components/intake/IntakeQuestionnaireReview'
import {
  CollegeAgentsBlock,
  CollegeHipaaRecipientsBlock,
  CollegeParentsBlock,
} from '@/components/intake/collegePrep/CollegePrepSteps'
import { DocumentPicker, DEFAULT_DOC_GROUPS, PlanStructurePicker } from '@/components/guided'
import { INTAKE_PLAN_TYPE_OPTIONS, normalizeIntakePlanType } from '@/lib/intakePlanType'
import { setDocumentInclusion, type DesignDocumentKey } from '@/lib/designSheetDocumentInclusions'
import { getIntakeAttorneyDocumentInclusions, type IntakeBlockId } from '@/lib/intake/forms/blockRegistry'

export interface IntakeBlockRendererProps extends StepProps {
  disabled?: boolean
  config?: Record<string, unknown>
  onAttorneySave?: (patch: { plan_type?: string; document_inclusions?: Record<string, boolean> }) => Promise<void>
}

const ReviewSubmitBlock = IntakeQuestionnaireReview

export {
  AdditionalContactsBlock, ChildrenBlock, ClientFiduciariesBlock,
  CollegeAgentsBlock, CollegeHipaaRecipientsBlock, CollegeParentsBlock,
  ExistingDocumentUploadsBlock, FinancialAssetsBlock, GuardianBlock,
  PlanningObjectivesBlock, ReviewSubmitBlock, SpouseDetailsBlock, SpouseFiduciariesBlock,
}

function str(data: Record<string, unknown>, key: string): string {
  return typeof data[key] === 'string' ? data[key] : ''
}

export function AddressBlock({ data, update, config }: IntakeBlockRendererProps) {
  return (
    <div className="space-y-3">
      {config?.profile === 'college' && (
        <p className="text-xs text-muted-foreground">
          The student&apos;s home address, not the campus address — this is what the documents recite.
        </p>
      )}
      <ContactAddressFields
        street={str(data, 'street_address')}
        city={str(data, 'city')}
        state={str(data, 'state') || 'MA'}
        zip={str(data, 'zip')}
        county={config?.includeCounty === false ? undefined : str(data, 'county')}
        onStreetChange={(value) => update('street_address', value)}
        onCityChange={(value) => update('city', value)}
        onStateChange={(value) => update('state', value)}
        onZipChange={(value) => update('zip', value)}
        onCountyChange={(value) => update('county', value)}
        onAddressSelect={(address) => {
          update('street_address', address.street)
          update('city', address.city)
          update('state', address.state || 'MA')
          update('zip', address.zip)
          if (address.county) update('county', address.county)
        }}
      />
      {config?.profile !== 'college' && (
        <p className="text-xs text-muted-foreground">Search to auto-fill, or enter manually below.</p>
      )}
    </div>
  )
}

export function AttorneyPlanStructureBlock({ data, onAttorneySave }: IntakeBlockRendererProps) {
  return (
    <PlanStructurePicker
      options={INTAKE_PLAN_TYPE_OPTIONS.map((option) => ({ value: option.value, title: option.title, sub: option.sub }))}
      selected={normalizeIntakePlanType(data.plan_type)}
      onSelect={(value) => { void onAttorneySave?.({ plan_type: value }) }}
    />
  )
}

export function AttorneyDocumentsBlock({ data, onAttorneySave }: IntakeBlockRendererProps) {
  return (
    <DocumentPicker
      inclusions={getIntakeAttorneyDocumentInclusions(data)}
      groups={DEFAULT_DOC_GROUPS}
      onToggle={(key: DesignDocumentKey, include: boolean) => {
        const current = { decisions: { document_inclusions: (data.document_inclusions as Record<string, unknown>) ?? {} } }
        const next = setDocumentInclusion(current, key, include)
        void onAttorneySave?.({ document_inclusions: next.document_inclusions as Record<string, boolean> })
      }}
    />
  )
}

export const INTAKE_BLOCK_RENDERERS = {
  address: AddressBlock,
  spouse_details: SpouseDetailsBlock,
  children: ChildrenBlock,
  financial_assets: FinancialAssetsBlock,
  planning_objectives: PlanningObjectivesBlock,
  existing_document_uploads: ExistingDocumentUploadsBlock,
  additional_contacts: AdditionalContactsBlock,
  client_fiduciaries: ClientFiduciariesBlock,
  spouse_fiduciaries: SpouseFiduciariesBlock,
  guardian: GuardianBlock,
  college_parents: CollegeParentsBlock,
  college_agents: CollegeAgentsBlock,
  college_hipaa_recipients: CollegeHipaaRecipientsBlock,
  review_submit: ReviewSubmitBlock,
  attorney_plan_structure: AttorneyPlanStructureBlock,
  attorney_documents: AttorneyDocumentsBlock,
} satisfies Record<IntakeBlockId, ComponentType<IntakeBlockRendererProps>>
