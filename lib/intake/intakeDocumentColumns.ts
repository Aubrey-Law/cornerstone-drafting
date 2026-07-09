export const INTAKE_DOCUMENT_COLUMNS =
  'id, client_intake_id, r2_key, name, size, content_type, kind, uploaded_by, created_at' as const

export type IntakeDocumentKind =
  | 'general'
  | 'existing_plan'
  | 'divorce_settlement'
  | 'gift_tax_return'

export const INTAKE_DOCUMENT_KIND_LABELS: Record<IntakeDocumentKind, string> = {
  general: 'Supporting documents',
  existing_plan: 'Estate planning documents',
  divorce_settlement: 'Divorce / settlement documents',
  gift_tax_return: 'Gift tax returns',
}

export interface IntakeDocumentRow {
  id: string
  client_intake_id: string
  r2_key: string
  name: string
  size: number
  content_type: string
  kind: string
  uploaded_by: string | null
  created_at: string
}
