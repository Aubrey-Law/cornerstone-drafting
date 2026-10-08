import type { Database } from '@aubrey-law/db-types'
import type { IntakeFormDefinition } from './types'

export type IntakeFormVersionStatus = 'draft' | 'published' | 'retired'

export type IntakeFormTemplateRow = Database['public']['Tables']['intake_form_templates']['Row']

/** Repository result only: raw database JSON must pass parseIntakeFormDefinition first. */
export type IntakeFormVersionRow = Omit<Database['public']['Tables']['intake_form_versions']['Row'], 'definition' | 'status'> & {
  definition: IntakeFormDefinition
  status: IntakeFormVersionStatus
}
