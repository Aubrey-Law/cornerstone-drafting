/**
 * Readiness scoring for a lead. Everything is derived from values already on
 * the lead row — the field predicates in `fieldDefinitions`, plus the intake and
 * engagement timestamps — so no new API surface is required.
 */
import type { LeadEditableField } from '@/lib/leads/details'
import {
  ENGAGEMENT_REQUIRED_FIELDS,
  FIELD_DEFINITIONS,
  hasText,
  leadFieldDefinition,
} from '@/lib/leads/fieldDefinitions'
import type { LeadDetailRecord, LeadSpouseRecord } from '@/lib/leads/viewTypes'

export type LeadReadinessItem = {
  /** Field key when the item maps to an editable field, otherwise a gate name. */
  key: LeadEditableField | 'intake' | 'engagement'
  label: string
  complete: boolean
  required: boolean
}

export type LeadReadiness = {
  items: LeadReadinessItem[]
  complete: number
  total: number
  percent: number
  /** Required items still outstanding, in definition order. */
  missing: LeadReadinessItem[]
  /** Every required item satisfied — the lead can be converted. */
  ready: boolean
}

export function intakeCompleted(lead: LeadDetailRecord): boolean {
  if (hasText(lead.intake_completed_at)) return true
  const status = typeof lead.intake_status === 'string' ? lead.intake_status.toLowerCase() : ''
  return status === 'submitted' || status === 'approved' || status === 'completed'
}

export function engagementStarted(lead: LeadDetailRecord): boolean {
  if (hasText(lead.engagement_sent_at) || hasText(lead.engagement_signed_at)) return true
  const status = typeof lead.engagement_status === 'string' ? lead.engagement_status.toLowerCase() : ''
  return status === 'sent' || status === 'signed' || status === 'completed'
}

export function computeLeadReadiness(
  lead: LeadDetailRecord,
  spouse: LeadSpouseRecord | null,
): LeadReadiness {
  const items: LeadReadinessItem[] = FIELD_DEFINITIONS.map(definition => ({
    key: definition.key,
    label: definition.missingLabel,
    complete: definition.complete(lead, spouse),
    required: ENGAGEMENT_REQUIRED_FIELDS.includes(definition.key),
  }))

  items.push(
    { key: 'intake', label: 'Intake', complete: intakeCompleted(lead), required: true },
    { key: 'engagement', label: 'Engagement', complete: engagementStarted(lead), required: false },
  )

  const complete = items.filter(item => item.complete).length
  const missing = items.filter(item => item.required && !item.complete)

  return {
    items,
    complete,
    total: items.length,
    percent: Math.round((complete / items.length) * 100),
    missing,
    ready: missing.length === 0,
  }
}

/** Human label for a readiness item, used by the dial subtitle and the Plan tab. */
export function readinessItemLabel(key: LeadReadinessItem['key']): string {
  if (key === 'intake') return 'Intake'
  if (key === 'engagement') return 'Engagement'
  return leadFieldDefinition(key)?.missingLabel ?? key
}
