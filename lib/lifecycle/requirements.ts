import type { LeadEditableField } from '@/lib/leads/details'
import type { IntakeReadinessFlag } from '@/lib/intakeReadiness'
import type { MatterStage, PipelineMatter } from '@/types/database'

interface EngagementState {
  signed: boolean
  sentAt: string | null
  status: string | null
}

export const LIFECYCLE_REGISTRY_VERSION = 'estate-planning-v1'

export type RequirementSeverity = 'information' | 'warning' | 'blocking'
export type RequirementOwner = 'client' | 'firm' | 'attorney'
export type RequirementResolution = 'client_fact' | 'attorney_judgment' | 'internal_action' | 'external_action'

export interface RequirementDefinition {
  key: string
  label: string
  source: string
  severity: RequirementSeverity
  owner: RequirementOwner
  resolution: RequirementResolution
  blocksStage: boolean
  stages: readonly string[]
}

export interface EvaluatedRequirement extends RequirementDefinition {
  satisfied: boolean
  detail?: string
}

/**
 * The facts needed to start an engagement. The readiness rail imports this list
 * so conversion, record UI, and future automation conditions cannot drift.
 */
export const LEAD_ENGAGEMENT_REQUIREMENTS = [
  ['firstName', 'Client name'],
  ['email', 'Client email'],
  ['address', 'Client address'],
  ['maritalStatus', 'Marital status'],
  ['spouse', 'Spouse identity when married'],
  ['practiceArea', 'Practice area'],
  ['fee', 'Quoted fee'],
] as const satisfies readonly (readonly [LeadEditableField, string])[]

export const LEAD_REQUIRED_FIELD_KEYS = LEAD_ENGAGEMENT_REQUIREMENTS
  .map(([key]) => key) as readonly LeadEditableField[]

const EARLY_MATTER_STAGES: readonly MatterStage[] = ['intake', 'intake_review', 'design', 'drafting']

export const MATTER_REQUIREMENTS: readonly RequirementDefinition[] = [
  {
    key: 'intake_sent', label: 'Intake questionnaire sent', source: 'pipeline matter',
    severity: 'blocking', owner: 'firm', resolution: 'external_action', blocksStage: true,
    stages: EARLY_MATTER_STAGES,
  },
  {
    key: 'intake_complete', label: 'Client intake complete', source: 'client intake',
    severity: 'blocking', owner: 'client', resolution: 'client_fact', blocksStage: true,
    stages: EARLY_MATTER_STAGES,
  },
  {
    key: 'engagement_signed', label: 'Engagement agreement signed', source: 'engagement agreement',
    severity: 'blocking', owner: 'client', resolution: 'external_action', blocksStage: true,
    stages: EARLY_MATTER_STAGES,
  },
  {
    key: 'review_flags_resolved', label: 'Intake and design conflicts resolved', source: 'intake readiness',
    severity: 'blocking', owner: 'attorney', resolution: 'attorney_judgment', blocksStage: true,
    stages: EARLY_MATTER_STAGES,
  },
]

function intakeState(matter: PipelineMatter) {
  const status = matter.intake_status?.toLowerCase() ?? ''
  const complete = ['completed', 'approved', 'submitted'].includes(status)
  return { sent: Boolean(matter.intake_sent_at) || status === 'sent' || complete, complete }
}

export function evaluateMatterRequirements(
  matter: PipelineMatter,
  engagement?: EngagementState,
  reviewFlags: IntakeReadinessFlag[] = [],
): EvaluatedRequirement[] {
  const intake = intakeState(matter)
  return MATTER_REQUIREMENTS
    .filter(requirement => requirement.stages.includes(matter.stage))
    .filter(requirement => requirement.key !== 'engagement_signed' || engagement !== undefined)
    .map(requirement => {
      if (requirement.key === 'intake_sent') return { ...requirement, satisfied: intake.sent }
      if (requirement.key === 'intake_complete') {
        return { ...requirement, satisfied: intake.complete, owner: intake.sent ? 'client' : 'firm' }
      }
      if (requirement.key === 'engagement_signed') {
        return {
          ...requirement,
          satisfied: Boolean(engagement?.signed),
          owner: engagement?.sentAt ? 'client' : 'firm',
          detail: engagement?.status ?? undefined,
        }
      }
      return { ...requirement, satisfied: reviewFlags.length === 0, detail: reviewFlags.length ? `${reviewFlags.length} unresolved` : undefined }
    })
}

export function nextMatterStage(stage: MatterStage): MatterStage | null {
  const order: readonly MatterStage[] = [
    'intake', 'intake_review', 'design', 'drafting', 'client_review', 'drafts_approved',
    'revision', 'signing_scheduled', 'signing_complete', 'post_execution', 'funding', 'closed',
  ]
  const index = order.indexOf(stage)
  return index >= 0 && index < order.length - 1 ? order[index + 1] : null
}

export function matterOperationalBrief(
  matter: PipelineMatter,
  engagement?: EngagementState,
  reviewFlags: IntakeReadinessFlag[] = [],
) {
  const requirements = evaluateMatterRequirements(matter, engagement, reviewFlags)
  return {
    version: LIFECYCLE_REGISTRY_VERSION,
    known: requirements.filter(item => item.satisfied).map(item => item.label),
    missing: requirements.filter(item => !item.satisfied && item.resolution === 'client_fact').map(item => item.label),
    clientFollowUp: requirements.filter(item => !item.satisfied && item.owner === 'client').map(item => item.label),
    attorneyDecision: requirements.filter(item => !item.satisfied && item.owner === 'attorney').map(item => item.label),
    conflicts: reviewFlags.map(flag => flag.label),
    nextStage: nextMatterStage(matter.stage),
    blockers: requirements.filter(item => !item.satisfied && item.blocksStage),
  }
}
