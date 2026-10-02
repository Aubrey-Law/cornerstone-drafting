/**
 * Compatibility barrel for the Phase 0 lifecycle seam.
 *
 * New code should import the focused registry/lead/matter module. Keeping this
 * barrel lets existing record pages migrate without a flag-day rewrite.
 */
export {
  ALL_LEAD_REQUIREMENTS,
  ALL_MATTER_REQUIREMENTS,
  COLLEGE_PREPARATION_LEAD_ENGAGEMENT_REQUIREMENTS,
  COLLEGE_PREPARATION_LEAD_WORKFLOW_REQUIREMENTS,
  COLLEGE_PREPARATION_MATTER_REQUIREMENTS,
  COLLEGE_PREPARATION_PRACTICE_AREAS,
  COLLEGE_PREPARATION_REQUIREMENT_REGISTRY,
  ESTATE_PLANNING_PRACTICE_AREAS,
  ESTATE_PLANNING_REQUIREMENT_REGISTRY,
  LEAD_ENGAGEMENT_REQUIREMENTS,
  LEAD_REQUIRED_FIELD_KEYS,
  LEAD_WORKFLOW_REQUIREMENTS,
  LIFECYCLE_REQUIREMENT_REGISTRIES,
  LIFECYCLE_REGISTRY_VERSION,
  MATTER_REQUIREMENTS,
  isSuggestionOnlySource,
  lifecycleRegistrySnapshot,
} from '@/lib/lifecycle/registry'
export type {
  EvaluatedRequirement,
  LifecycleRecordType,
  RequirementApplicability,
  RequirementDefinition,
  RequirementOwner,
  RequirementResolution,
  RequirementSeverity,
  RequirementSource,
  RequirementSourceKind,
} from '@/lib/lifecycle/registry'
export {
  evaluateMatterRequirements,
  matterOperationalBrief,
  matterStageTransitionPreflight,
  nextMatterStage,
} from '@/lib/lifecycle/matter'
export type { EngagementState, MatterLifecycleContext } from '@/lib/lifecycle/matter'
export { evaluateLeadRequirements, leadOperationalBrief } from '@/lib/lifecycle/lead'
export type { LeadLifecycleContext } from '@/lib/lifecycle/lead'
