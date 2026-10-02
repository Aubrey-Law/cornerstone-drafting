import { leadFieldApplies, leadFieldDefinition } from '@/lib/leads/fieldDefinitions'
import type { NextAction } from '@/lib/leads/nextAction'
import type { LeadDetailRecord, LeadSpouseRecord } from '@/lib/leads/viewTypes'
import {
  ALL_LEAD_REQUIREMENTS,
  LIFECYCLE_REGISTRY_VERSION,
  requirementAppliesToPracticeArea,
  type EvaluatedRequirement,
  type RequirementDefinition,
} from '@/lib/lifecycle/registry'

export interface LeadLifecycleContext {
  lead: LeadDetailRecord
  spouse: LeadSpouseRecord | null
  nextAction?: NextAction | null
  nextAppointmentAt?: string | null
}

function evaluateFieldRequirement(
  requirement: RequirementDefinition,
  context: LeadLifecycleContext,
): EvaluatedRequirement | null {
  const definition = leadFieldDefinition(requirement.source.field as never)
  if (!definition || !leadFieldApplies(definition, context.lead)) return null
  return {
    ...requirement,
    satisfied: definition.complete(context.lead, context.spouse),
  }
}

function normalizedStatus(lead: LeadDetailRecord): string {
  return typeof lead.engagement_status === 'string' ? lead.engagement_status.toLowerCase() : ''
}

function evaluateWorkflowRequirement(
  requirement: RequirementDefinition,
  context: LeadLifecycleContext,
): EvaluatedRequirement | null {
  const { lead } = context
  const status = normalizedStatus(lead)
  const intakeComplete = Boolean(lead.intake_completed_at)
    || ['submitted', 'approved', 'completed'].includes(String(lead.status ?? lead.intake_status ?? '').toLowerCase())
  const engagementStarted = Boolean(lead.engagement_sent_at || lead.engagement_signed_at)
    || ['draft', 'ready', 'failed', 'sending', 'sent', 'viewed', 'partially_signed', 'signed', 'completed'].includes(status)
  const engagementSigned = Boolean(lead.engagement_signed_at) || ['signed', 'completed'].includes(status)

  switch (requirement.key) {
    case 'lead.intake_sent':
      return { ...requirement, satisfied: Boolean(lead.intake_sent_at) || intakeComplete }
    case 'lead.intake_complete':
      if (!lead.intake_sent_at && !intakeComplete) return null
      return { ...requirement, satisfied: intakeComplete }
    case 'lead.engagement_started':
      if (!intakeComplete) return null
      return { ...requirement, satisfied: engagementStarted }
    case 'lead.engagement_signed':
      if (!engagementStarted) return null
      return { ...requirement, satisfied: engagementSigned }
    default:
      return null
  }
}

export function evaluateLeadRequirements(
  lead: LeadDetailRecord,
  spouse: LeadSpouseRecord | null,
): EvaluatedRequirement[] {
  const context = { lead, spouse }
  return [
    ...ALL_LEAD_REQUIREMENTS
      .filter(requirement => requirementAppliesToPracticeArea(requirement, lead.practice_area))
      .map(requirement => (
        leadFieldDefinition(requirement.source.field as never)
          ? evaluateFieldRequirement(requirement, context)
          : evaluateWorkflowRequirement(requirement, context)
      )),
  ].filter((requirement): requirement is EvaluatedRequirement => requirement !== null)
}

function nextLeadMilestone(context: LeadLifecycleContext): string | null {
  const action = context.nextAction
  if (!action || action.key === 'nothing') return context.lead.lead_status === 'hired' ? 'Matter opened' : null
  const milestones: Record<NextAction['key'], string | null> = {
    send_intake: 'Intake sent',
    review_intake: 'Intake reviewed',
    quote_fee: 'Fee approved',
    draft_engagement: 'Engagement sent',
    follow_up: 'Client response',
    nothing: null,
    review_engagement: 'Engagement confirmed',
    prepare_meeting: 'Planning session ready',
    schedule_meeting: 'Planning session scheduled',
  }
  return milestones[action.key]
}

export function leadOperationalBrief(context: LeadLifecycleContext) {
  const requirements = evaluateLeadRequirements(context.lead, context.spouse)
  const unmet = requirements.filter(requirement => !requirement.satisfied)
  const intakeSubmitted = Boolean(context.lead.intake_completed_at)
    || ['submitted', 'approved', 'completed'].includes(String(context.lead.status ?? context.lead.intake_status ?? '').toLowerCase())
  const draftFactsNeedConfirmation = !intakeSubmitted
    && String(context.lead.status ?? context.lead.intake_status ?? '').toLowerCase() === 'draft'
  const fieldRequirementKeys = new Set(
    requirements.filter(requirement => leadFieldDefinition(requirement.source.field as never))
      .map(requirement => requirement.key),
  )
  const meetingPreparation = context.nextAppointmentAt
    ? [
        'Review the lead record and recent communications.',
        ...(intakeSubmitted ? ['Review the submitted intake before the meeting.'] : ['Confirm when the client will complete the intake.']),
        ...unmet.filter(item => item.resolution === 'client_fact').slice(0, 3).map(item => `Clarify: ${item.label}.`),
      ]
    : []

  return {
    version: LIFECYCLE_REGISTRY_VERSION,
    known: requirements
      .filter(item => item.satisfied && (!draftFactsNeedConfirmation || !fieldRequirementKeys.has(item.key)))
      .map(item => item.label),
    missing: unmet
      .filter(item => fieldRequirementKeys.has(item.key))
      .map(item => item.label),
    clientFollowUp: unmet.filter(item => item.owner === 'client').map(item => item.label),
    attorneyDecision: unmet.filter(item => item.owner === 'attorney').map(item => item.label),
    conflicts: draftFactsNeedConfirmation
      ? ['Draft intake values require review before they are treated as confirmed facts.']
      : [],
    nextStage: nextLeadMilestone(context),
    blockers: unmet.filter(item => item.blocksStage),
    meetingPreparation,
    nextAction: context.nextAction ?? null,
  }
}
