import type { SharedFieldId } from '@aubrey-law/estate-fields/core'

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
  | { op: 'equals'; fieldId: SharedFieldId; value: string | boolean }
  | { op: 'not_equals'; fieldId: SharedFieldId; value: string | boolean }
  | { op: 'is_set'; fieldId: SharedFieldId }
  | { op: 'all' | 'any'; conditions: IntakeCondition[] }

export type IntakeFormItem =
  | {
      kind: 'field'
      id: string
      fieldId: SharedFieldId
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
  schemaVersion: 1
  key: string
  title: string
  description?: string
  sections: IntakeFormSection[]
}
