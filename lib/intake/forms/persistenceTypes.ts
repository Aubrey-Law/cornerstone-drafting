import type { Database, Json } from '@aubrey-law/db-types'
import type { IntakeFormDefinition } from './types'

export type IntakeFormVersionStatus = 'draft' | 'published' | 'retired'

export type IntakeFormTemplateRow = Database['public']['Tables']['intake_form_templates']['Row']

/** Repository result only: raw database JSON must pass parseIntakeFormDefinition first. */
export type IntakeFormVersionRow = Omit<Database['public']['Tables']['intake_form_versions']['Row'], 'definition' | 'status'> & {
  definition: IntakeFormDefinition
  status: IntakeFormVersionStatus
}

export type IntakeFormAuditAction = 'create' | 'save' | 'create_next_draft' | 'publish' | 'retire' | 'archive' | 'restore' | 'duplicate' | 'discard'
export type IntakeFormAuditEventRow = Omit<Database['public']['Tables']['intake_form_audit_events']['Row'], 'action' | 'metadata'> & {
  action: IntakeFormAuditAction
  metadata: Record<string, Json>
}

export interface IntakeFormTemplateSummary {
  template: IntakeFormTemplateRow
  lastModifiedAt: string
  draft: IntakeFormVersionRow | null
  latestPublished: IntakeFormVersionRow | null
  latestVersion: IntakeFormVersionRow | null
}

export interface IntakeFormEditorSnapshot {
  template: IntakeFormTemplateRow
  versions: IntakeFormVersionRow[]
  draft: IntakeFormVersionRow | null
  auditEvents: IntakeFormAuditEventRow[]
}
