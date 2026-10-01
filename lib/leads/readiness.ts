/**
 * Readiness scoring for a lead. Everything is derived from values already on
 * the lead row — the field predicates in `fieldDefinitions`, plus the intake and
 * engagement timestamps — so no new API surface is required.
 */
import type { LeadEditableField } from '@/lib/leads/details'
import {
  FIELD_DEFINITIONS,
  hasText,
  leadFieldApplies,
  leadFieldDefinition,
} from '@/lib/leads/fieldDefinitions'
import { evaluateLeadRequirements } from '@/lib/lifecycle/lead'
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

const SUBMITTED_INTAKE_STATUSES = ['submitted', 'approved', 'completed']

export function intakeCompleted(lead: LeadDetailRecord): boolean {
  if (hasText(lead.intake_completed_at)) return true
  // `client_intake.status` is the intake's own status column. `intake_status`
  // is not a column on that table — it only exists as the optimistic local
  // value the detail client sets after sending an intake.
  return [lead.status, lead.intake_status]
    .map(value => (typeof value === 'string' ? value.toLowerCase() : ''))
    .some(value => SUBMITTED_INTAKE_STATUSES.includes(value))
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
  const lifecycle = new Map(
    evaluateLeadRequirements(lead, spouse).map(requirement => [requirement.source.field, requirement]),
  )
  const items: LeadReadinessItem[] = FIELD_DEFINITIONS
    .filter(definition => leadFieldApplies(definition, lead))
    .map(definition => ({
      key: definition.key,
      label: definition.missingLabel,
      complete: definition.complete(lead, spouse),
      required: lifecycle.has(definition.key),
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
