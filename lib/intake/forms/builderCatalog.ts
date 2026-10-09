import {
  BUILDER_FIELD_IDS, getBuilderField,
  type BuilderFieldDef, type FieldOption, type SharedFieldControl, type SharedFieldId,
} from '@aubrey-law/estate-fields/core'
import { getIntakeBlock } from './blockRegistry'
import type { IntakeAudience, IntakeBlockId, IntakeRequirement } from './types'

export interface BuilderCatalogField {
  id: SharedFieldId
  label: string
  description: string
  group: string
  control: SharedFieldControl
  baselineRequirement: IntakeRequirement
  validationProfile: NonNullable<BuilderFieldDef['validationProfile']>
  options?: FieldOption[]
  audiences: IntakeAudience[]
}

export type BuilderConfigControl =
  | { key: 'profile'; label: string; control: 'select'; options: FieldOption[] }
  | { key: 'includeCounty'; label: string; control: 'boolean' }

export interface BuilderCatalogBlock {
  id: IntakeBlockId
  label: string
  description: string
  group: string
  audiences: IntakeAudience[]
  configControls: BuilderConfigControl[]
}

export interface IntakeFormBuilderCatalog {
  fields: BuilderCatalogField[]
  blocks: BuilderCatalogBlock[]
}

const CONTROL_DESCRIPTION = {
  text: 'Short plain-text answer.',
  email: 'Email address with code-owned validation.',
  tel: 'Telephone number with code-owned validation.',
  date: 'Calendar date with code-owned validation.',
  textarea: 'Long plain-text answer.',
  select: 'Choose one approved option.',
  boolean: 'Yes or no answer.',
  multiselect: 'Choose any approved options.',
} as const satisfies Record<SharedFieldControl, string>

const BLOCK_COPY = {
  address: ['Address', 'Client and household', 'Canonical mailing address fields.'],
  spouse_details: ['Spouse details', 'Client and household', 'Spouse identity and contact details.'],
  children: ['Children', 'People and fiduciaries', 'Canonical child collection and relationship details.'],
  financial_assets: ['Financial assets', 'Estate planning', 'Estate asset categories and totals.'],
  planning_objectives: ['Planning objectives', 'Estate planning', 'Goals and reasons for planning.'],
  existing_document_uploads: ['Existing documents', 'Documents', 'Existing-plan document uploads.'],
  additional_contacts: ['Additional contacts', 'People and fiduciaries', 'Other matter-scoped people.'],
  client_fiduciaries: ['Client fiduciaries', 'People and fiduciaries', 'Client fiduciary choices and ranking.'],
  spouse_fiduciaries: ['Spouse fiduciaries', 'People and fiduciaries', 'Spouse fiduciary choices and ranking.'],
  guardian: ['Guardian', 'People and fiduciaries', 'Guardian choice for minor children.'],
  college_parents: ['Parents and guardians', 'College preparation', 'Student parent or guardian contacts.'],
  college_agents: ['College agents', 'College preparation', 'Financial and health-care agents.'],
  college_hipaa_recipients: ['HIPAA recipients', 'College preparation', 'People authorized to receive health information.'],
  review_submit: ['Review and submit', 'Workflow', 'Required shared review and submission path.'],
  attorney_plan_structure: ['Plan structure', 'Attorney only', 'Attorney plan-type selection.'],
  attorney_documents: ['Documents to prepare', 'Attorney only', 'Attorney document inclusion selection.'],
} as const satisfies Record<IntakeBlockId, readonly [string, string, string]>

function fieldGroup(id: SharedFieldId): string {
  if (id.startsWith('college_')) return 'College preparation'
  if (id.startsWith('client_') || ['street', 'city', 'state', 'zip', 'county', 'marital_status', 'marriage_date'].includes(id)) return 'Client and household'
  if (['estate_value', 'asset_types', 'planning_goals', 'special_notes'].includes(id)) return 'Estate planning'
  return 'Background'
}

/** Explicit display-only projection. Never send executable registry definitions to the browser. */
export function getIntakeFormBuilderCatalog(): IntakeFormBuilderCatalog {
  return {
    fields: BUILDER_FIELD_IDS.map(id => {
      const field = getBuilderField(id)
      return {
        id,
        label: field.label,
        description: CONTROL_DESCRIPTION[field.control],
        group: fieldGroup(id),
        control: field.control,
        baselineRequirement: field.baselineRequirement,
        validationProfile: field.validationProfile ?? 'none',
        ...(field.options ? { options: field.options.map(({ value, label }) => ({ value, label })) } : {}),
        audiences: ['client_and_staff', 'staff_only'],
      }
    }),
    blocks: (Object.keys(BLOCK_COPY) as IntakeBlockId[]).map(id => {
      const [label, group, description] = BLOCK_COPY[id]
      return {
        id, label, group, description,
        audiences: [...getIntakeBlock(id).audiences],
        configControls: id === 'address' ? [
          { key: 'profile', label: 'Address profile', control: 'select', options: [
            { value: 'estate', label: 'Estate planning' },
            { value: 'college', label: 'College preparation' },
          ] },
          { key: 'includeCounty', label: 'Ask for Massachusetts county', control: 'boolean' },
        ] : [],
      }
    }),
  }
}
