import type { IntakeReadinessFlag } from '@/lib/intakeReadiness'
import {
  ALL_MATTER_REQUIREMENTS,
  LIFECYCLE_REGISTRY_VERSION,
  requirementAppliesToPracticeArea,
  type EvaluatedRequirement,
  type RequirementDefinition,
} from '@/lib/lifecycle/registry'
import { STAGES, type MatterStage, type PipelineMatter } from '@/types/database'

export interface EngagementState {
  signed: boolean
  sentAt: string | null
  status: string | null
}

export interface MatterLifecycleContext {
  matter: PipelineMatter
  engagement?: EngagementState
  /** Undefined means the review source could not be evaluated. */
  reviewFlags?: IntakeReadinessFlag[]
  targetStage?: MatterStage
}

function requirementApplies(
  requirement: RequirementDefinition,
  context: MatterLifecycleContext,
): boolean {
  if (!requirementAppliesToPracticeArea(requirement, context.matter.practice_area)) return false
  if (context.targetStage) return requirement.requiredBeforeStages?.includes(context.targetStage) ?? false
  return requirement.applicability.stages.includes(context.matter.stage)
}

function evaluate(
  requirement: RequirementDefinition,
  context: MatterLifecycleContext,
): EvaluatedRequirement | null {
  const { matter, engagement, reviewFlags } = context

  switch (requirement.key) {
    case 'matter.engagement_signed':
      if (engagement === undefined) return null
      return {
        ...requirement,
        satisfied: engagement.signed,
        owner: engagement.sentAt ? 'client' : 'firm',
        detail: engagement.status ?? undefined,
      }
    case 'matter.review_flags_resolved':
      if (reviewFlags === undefined) return null
      return {
        ...requirement,
        satisfied: reviewFlags.length === 0,
        detail: reviewFlags.length ? `${reviewFlags.length} unresolved` : undefined,
      }
    case 'matter.design_ready':
      return {
        ...requirement,
        satisfied: ['ready', 'generated', 'signed'].includes(matter.design_status?.toLowerCase() ?? ''),
        detail: matter.design_status ?? undefined,
      }
    case 'matter.drafts_shared':
      return { ...requirement, satisfied: Boolean(matter.drafts_sent_at) }
    case 'matter.signing_scheduled':
      return { ...requirement, satisfied: Boolean(matter.signing_date) }
    case 'matter.documents_executed':
      return { ...requirement, satisfied: Boolean(matter.documents_executed_at) }
    default:
      return null
  }
}

export function evaluateMatterRequirements(
  matter: PipelineMatter,
  engagement?: EngagementState,
  reviewFlags?: IntakeReadinessFlag[],
  options: { targetStage?: MatterStage } = {},
): EvaluatedRequirement[] {
  const context = { matter, engagement, reviewFlags, targetStage: options.targetStage }
  return ALL_MATTER_REQUIREMENTS
    .filter(requirement => requirementApplies(requirement, context))
    .map(requirement => evaluate(requirement, context))
    .filter((requirement): requirement is EvaluatedRequirement => requirement !== null)
}

export function nextMatterStage(stage: MatterStage): MatterStage | null {
  const stages = STAGES.filter(entry => entry.key !== 'intake' && entry.key !== 'intake_review')
  if (stage === 'intake' || stage === 'intake_review') return 'design'
  const index = stages.findIndex(entry => entry.key === stage)
  return index >= 0 && index < stages.length - 1 ? stages[index + 1].key : null
}

export function matterStageTransitionPreflight(
  matter: PipelineMatter,
  targetStage: MatterStage,
  engagement?: EngagementState,
  reviewFlags?: IntakeReadinessFlag[],
) {
  const currentIndex = STAGES.findIndex(entry => entry.key === matter.stage)
  const targetIndex = STAGES.findIndex(entry => entry.key === targetStage)
  const forward = targetIndex > currentIndex
  const requirements = forward
    ? evaluateMatterRequirements(matter, engagement, reviewFlags, { targetStage })
    : []
  const blockers = requirements.filter(requirement => !requirement.satisfied && requirement.blocksStage)
  return {
    version: LIFECYCLE_REGISTRY_VERSION,
    fromStage: matter.stage,
    targetStage,
    forward,
    requirements,
    blockers,
    requiresConfirmation: blockers.length > 0,
  }
}

export function matterOperationalBrief(
  matter: PipelineMatter,
  engagement?: EngagementState,
  reviewFlags?: IntakeReadinessFlag[],
) {
  const requirements = evaluateMatterRequirements(matter, engagement, reviewFlags)
  const unmet = requirements.filter(requirement => !requirement.satisfied)
  const nextStage = nextMatterStage(matter.stage)
  const transition = nextStage
    ? matterStageTransitionPreflight(matter, nextStage, engagement, reviewFlags)
    : null
  const flags = reviewFlags ?? []
  const clientFlagLabels = flags
    .filter(flag => (flag.resolutionKind ?? 'needs_data') === 'needs_data')
    .map(flag => flag.label)
  const attorneyFlagLabels = flags
    .filter(flag => flag.resolutionKind === 'attorney_judgment')
    .map(flag => flag.label)
  const meetingPreparation = matter.next_appointment
    ? [
        'Review the operational brief and recent communications.',
        ...clientFlagLabels.slice(0, 3).map(label => `Clarify: ${label}.`),
        ...attorneyFlagLabels.slice(0, 3).map(label => `Decide: ${label}.`),
      ]
    : []

  return {
    version: LIFECYCLE_REGISTRY_VERSION,
    known: requirements.filter(item => item.satisfied).map(item => item.label),
    missing: [
      ...unmet.filter(item => item.resolution === 'client_fact').map(item => item.label),
      ...clientFlagLabels,
    ],
    clientFollowUp: [
      ...unmet.filter(item => item.owner === 'client').map(item => item.label),
      ...clientFlagLabels,
    ],
    attorneyDecision: [
      ...unmet.filter(item => item.owner === 'attorney').map(item => item.label),
      ...attorneyFlagLabels,
    ],
    conflicts: attorneyFlagLabels,
    nextStage,
    blockers: transition?.blockers ?? unmet.filter(item => item.blocksStage),
    meetingPreparation,
  }
}
