import type { FormFieldId } from '@/lib/discovery/catalog'

export type IntakeAudience = 'client_and_staff' | 'staff_only'
export type IntakeRequirement = 'optional' | 'recommended' | 'required'
export type IntakeBlockId =
  | 'address'
  | 'spouse_details'
  | 'children'
  | 'financial_assets'
  | 'planning_objectives'
  | 'existing_document_uploads'
  | 'additional_contacts'
  | 'client_fiduciaries'
  | 'spouse_fiduciaries'
  | 'guardian'
  | 'college_parents'
  | 'college_agents'
  | 'college_hipaa_recipients'
  | 'review_submit'
  | 'attorney_plan_structure'
  | 'attorney_documents'

export type IntakeCondition =
  | { op: 'equals'; fieldId: FormFieldId; value: string | boolean }
  | { op: 'not_equals'; fieldId: FormFieldId; value: string | boolean }
  | { op: 'is_set'; fieldId: FormFieldId }
  | { op: 'all' | 'any'; conditions: IntakeCondition[] }

export type IntakeFormItem =
  | {
      kind: 'field'
      id: string
      fieldId: FormFieldId
      labelOverride?: string
      helpText?: string
      requirement?: IntakeRequirement
      condition?: IntakeCondition
    }
  | {
      kind: 'block'
      id: string
      blockId: IntakeBlockId
      titleOverride?: string
      helpText?: string
      config?: Record<string, unknown>
      condition?: IntakeCondition
    }

export interface IntakeFormSection {
  id: string
  title: string
  subtitle?: string
  timeEstimateMinutes?: number
  optional?: boolean
  audience: IntakeAudience
  condition?: IntakeCondition
  items: IntakeFormItem[]
}

export interface IntakeFormDefinition {
  purpose?: 'client_intake' | 'discovery_call'
  schemaVersion: 1
  key: string
  title: string
  description?: string
  sections: IntakeFormSection[]
}
