import { BUILDER_FIELD_IDS, type SharedFieldId } from '@aubrey-law/estate-fields/core'
import { isStaffAppointmentBlock } from './staffAppointments'
import { isStaffHouseholdBlock } from './staffHousehold'

// These answers have single-row storage and no contact synchronization side effects.
const fields = new Set<string>(BUILDER_FIELD_IDS)
export function isStaffEditableQuestion(fieldId: string): fieldId is SharedFieldId {
  return fields.has(fieldId)
}

export interface StaffQuestionEdit {
  intakeId: string
  expectedVersionId: string
  expectedUpdatedAt: string | null
  fieldId: string
  value: unknown
}

export function isStaffEditableBlock(blockId: string): boolean {
  return blockId === 'existing_document_uploads' || blockId === 'address' || blockId === 'college_hipaa_recipients' || blockId === 'planning_objectives' || blockId === 'financial_assets' || isStaffContactBlock(blockId) || isStaffAppointmentBlock(blockId) || isStaffHouseholdBlock(blockId)
}

export function isStaffContactBlock(blockId: string): boolean {
  return blockId === 'additional_contacts' || blockId === 'college_parents'
}
