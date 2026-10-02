import type { LeadEditableField } from '@/lib/leads/details'
import { parsePracticeArea } from '@/lib/practiceArea'
import type { MatterStage } from '@/types/database'

export const LIFECYCLE_REGISTRY_VERSION = 'practice-areas-v3'

export type LifecycleRecordType = 'lead' | 'matter'
export type RequirementSeverity = 'information' | 'warning' | 'blocking'
export type RequirementOwner = 'client' | 'firm' | 'attorney'
export type RequirementResolution =
  | 'client_fact'
  | 'attorney_judgment'
  | 'internal_action'
  | 'external_action'

export type RequirementSourceKind =
  | 'record'
  | 'client_submission'
  | 'engagement'
  | 'design_sheet'
  | 'intake_review'
  | 'calendar'
  | 'document_extraction'
  | 'communication_extraction'

export interface RequirementSource {
  kind: RequirementSourceKind
  /** Human-readable field or subsystem, never client content. */
  field: string
  /** Extraction is suggestion-only until a person confirms it. */
  confirmation: 'recorded' | 'submitted' | 'attorney_confirmed' | 'suggestion_only'
}

export interface RequirementApplicability {
  practiceAreas: readonly string[]
  stages: readonly string[]
  condition: string
}

export interface RequirementDefinition {
  key: string
  recordType: LifecycleRecordType
  label: string
  source: RequirementSource
  applicability: RequirementApplicability
  severity: RequirementSeverity
  owner: RequirementOwner
  resolution: RequirementResolution
  blocksStage: boolean
  /** A requirement is checked before entering any of these matter stages. */
  requiredBeforeStages?: readonly MatterStage[]
}

export interface EvaluatedRequirement extends RequirementDefinition {
  satisfied: boolean
  detail?: string
}

export const ESTATE_PLANNING_PRACTICE_AREAS = ['EP', 'EP-LP', 'ESTATE_PLANNING'] as const
/**
 * The College Preparation Plan has a distinct operational lifecycle. This is
 * deliberately a small registry: it describes workflow gates the app can
 * verify, while the college-plan intake review remains the source of record
 * for substantive client choices.
 */
export const COLLEGE_PREPARATION_PRACTICE_AREAS = ['CP'] as const

const LEAD_STAGES = [
  'new_lead',
  'discovery_call',
  'intake_sent',
  'intake_completed',
  'engagement_sent',
] as const

const EARLY_MATTER_STAGES: readonly MatterStage[] = ['intake', 'intake_review', 'design', 'drafting']

function leadField(
  key: LeadEditableField,
  label: string,
  options: Partial<Pick<RequirementDefinition, 'owner' | 'resolution'>> & {
    condition?: string
    practiceAreas?: readonly string[]
  } = {},
): RequirementDefinition {
  return {
    key: `lead.${key}`,
    recordType: 'lead',
    label,
    source: { kind: 'record', field: key, confirmation: 'recorded' },
    applicability: {
      practiceAreas: options.practiceAreas ?? ESTATE_PLANNING_PRACTICE_AREAS,
      stages: LEAD_STAGES,
      condition: options.condition ?? 'Always required before engagement.',
    },
    severity: 'blocking',
    owner: options.owner ?? 'firm',
    resolution: options.resolution ?? 'internal_action',
    blocksStage: true,
  }
}

/**
 * The complete estate-planning lead gate. Field keys are metadata, not a
 * second implementation of field completeness: the evaluator calls the same
 * field predicates used by the lead rail.
 */
export const LEAD_ENGAGEMENT_REQUIREMENTS = [
  leadField('firstName', 'Client name'),
  leadField('email', 'Client email'),
  leadField('address', 'Client address', { owner: 'client', resolution: 'client_fact' }),
  leadField('maritalStatus', 'Marital status', { owner: 'client', resolution: 'client_fact' }),
  leadField('spouse', 'Spouse identity when married', {
    owner: 'client',
    resolution: 'client_fact',
    condition: 'Required only when marital status is married.',
  }),
  leadField('practiceArea', 'Practice area', { owner: 'attorney', resolution: 'attorney_judgment' }),
  leadField('fee', 'Quoted fee', { owner: 'attorney', resolution: 'attorney_judgment' }),
] as const satisfies readonly RequirementDefinition[]

export const LEAD_REQUIRED_FIELD_KEYS = LEAD_ENGAGEMENT_REQUIREMENTS.map(
  requirement => requirement.source.field,
) as readonly LeadEditableField[]

/**
 * The client-facing College Preparation questionnaire supplies the detailed
 * plan facts. Before the engagement, Cornerstone only gates the operational
 * fields needed to identify, contact, price, and route the lead correctly.
 */
export const COLLEGE_PREPARATION_LEAD_ENGAGEMENT_REQUIREMENTS = [
  leadField('firstName', 'Primary contact name', { practiceAreas: COLLEGE_PREPARATION_PRACTICE_AREAS }),
  leadField('email', 'Primary contact email', { practiceAreas: COLLEGE_PREPARATION_PRACTICE_AREAS }),
  leadField('practiceArea', 'Practice area', {
    owner: 'attorney',
    resolution: 'attorney_judgment',
    practiceAreas: COLLEGE_PREPARATION_PRACTICE_AREAS,
  }),
  leadField('fee', 'Quoted fee', {
    owner: 'attorney',
    resolution: 'attorney_judgment',
    practiceAreas: COLLEGE_PREPARATION_PRACTICE_AREAS,
  }),
] as const satisfies readonly RequirementDefinition[]

function leadWorkflowRequirements(practiceAreas: readonly string[]): readonly RequirementDefinition[] {
  return [
  {
    key: 'lead.intake_sent', recordType: 'lead', label: 'Intake questionnaire sent',
    source: { kind: 'record', field: 'intake_sent_at', confirmation: 'recorded' },
    applicability: { practiceAreas, stages: LEAD_STAGES, condition: 'Open lead.' },
    severity: 'warning', owner: 'firm', resolution: 'external_action', blocksStage: false,
  },
  {
    key: 'lead.intake_complete', recordType: 'lead', label: 'Client intake complete',
    source: { kind: 'client_submission', field: 'intake_completed_at/status', confirmation: 'submitted' },
    applicability: { practiceAreas, stages: LEAD_STAGES, condition: 'After the intake is sent.' },
    severity: 'blocking', owner: 'client', resolution: 'client_fact', blocksStage: true,
  },
  {
    key: 'lead.engagement_started', recordType: 'lead', label: 'Engagement agreement prepared',
    source: { kind: 'engagement', field: 'engagement_status/sent_at', confirmation: 'recorded' },
    applicability: { practiceAreas, stages: LEAD_STAGES, condition: 'After intake and fee review.' },
    severity: 'blocking', owner: 'firm', resolution: 'external_action', blocksStage: true,
  },
  {
    key: 'lead.engagement_signed', recordType: 'lead', label: 'Engagement agreement signed',
    source: { kind: 'engagement', field: 'engagement_signed_at/status', confirmation: 'recorded' },
    applicability: { practiceAreas, stages: LEAD_STAGES, condition: 'After an engagement is sent.' },
    severity: 'blocking', owner: 'client', resolution: 'external_action', blocksStage: true,
  },
  ]
}

export const LEAD_WORKFLOW_REQUIREMENTS = leadWorkflowRequirements(ESTATE_PLANNING_PRACTICE_AREAS)
export const COLLEGE_PREPARATION_LEAD_WORKFLOW_REQUIREMENTS = leadWorkflowRequirements(
  COLLEGE_PREPARATION_PRACTICE_AREAS,
)

const FROM_INTAKE_REVIEW: readonly MatterStage[] = [
  'intake_review', 'design', 'drafting', 'client_review', 'revision', 'drafts_approved',
  'signing_scheduled', 'signing_complete', 'post_execution', 'funding', 'closed',
]
const FROM_DESIGN: readonly MatterStage[] = [
  'design', 'drafting', 'client_review', 'revision', 'drafts_approved', 'signing_scheduled',
  'signing_complete', 'post_execution', 'funding', 'closed',
]
const FROM_DRAFTING: readonly MatterStage[] = [
  'drafting', 'client_review', 'revision', 'drafts_approved', 'signing_scheduled',
  'signing_complete', 'post_execution', 'funding', 'closed',
]
const FROM_CLIENT_REVIEW: readonly MatterStage[] = [
  'client_review', 'revision', 'drafts_approved', 'signing_scheduled', 'signing_complete',
  'post_execution', 'funding', 'closed',
]
const FROM_EXECUTION: readonly MatterStage[] = ['signing_complete', 'post_execution', 'funding', 'closed']

function matterRequirements(practiceAreas: readonly string[]): readonly RequirementDefinition[] {
  return [
  {
    key: 'matter.intake_sent', recordType: 'matter', label: 'Intake questionnaire sent',
    source: { kind: 'record', field: 'intake_sent_at/status', confirmation: 'recorded' },
    applicability: { practiceAreas, stages: EARLY_MATTER_STAGES, condition: 'Matter is in intake.' },
    severity: 'blocking', owner: 'firm', resolution: 'external_action', blocksStage: true,
    requiredBeforeStages: FROM_INTAKE_REVIEW,
  },
  {
    key: 'matter.intake_complete', recordType: 'matter', label: 'Client intake complete',
    source: { kind: 'client_submission', field: 'intake_completed_at/status', confirmation: 'submitted' },
    applicability: { practiceAreas, stages: EARLY_MATTER_STAGES, condition: 'Intake was sent.' },
    severity: 'blocking', owner: 'client', resolution: 'client_fact', blocksStage: true,
    requiredBeforeStages: FROM_DESIGN,
  },
  {
    key: 'matter.engagement_signed', recordType: 'matter', label: 'Engagement agreement signed',
    source: { kind: 'engagement', field: 'engagement_signed/status', confirmation: 'recorded' },
    applicability: { practiceAreas, stages: EARLY_MATTER_STAGES, condition: 'E-sign is enabled for the matter.' },
    severity: 'blocking', owner: 'client', resolution: 'external_action', blocksStage: true,
    requiredBeforeStages: FROM_DESIGN,
  },
  {
    key: 'matter.review_flags_resolved', recordType: 'matter', label: 'Intake and design conflicts resolved',
    source: { kind: 'intake_review', field: 'intake_review_flags', confirmation: 'attorney_confirmed' },
    applicability: { practiceAreas, stages: FROM_INTAKE_REVIEW, condition: 'Review flags were evaluated.' },
    severity: 'blocking', owner: 'attorney', resolution: 'attorney_judgment', blocksStage: true,
    requiredBeforeStages: FROM_DRAFTING,
  },
  {
    key: 'matter.design_ready', recordType: 'matter', label: 'Design sheet approved for drafting',
    source: { kind: 'design_sheet', field: 'status', confirmation: 'attorney_confirmed' },
    applicability: { practiceAreas, stages: ['design', 'drafting'], condition: 'A design sheet exists.' },
    severity: 'blocking', owner: 'attorney', resolution: 'attorney_judgment', blocksStage: true,
    requiredBeforeStages: FROM_CLIENT_REVIEW,
  },
  {
    key: 'matter.drafts_shared', recordType: 'matter', label: 'Reviewed drafts shared with client',
    source: { kind: 'record', field: 'drafts_sent_at', confirmation: 'recorded' },
    applicability: { practiceAreas, stages: ['drafting', 'client_review', 'revision'], condition: 'Drafting is underway.' },
    severity: 'blocking', owner: 'firm', resolution: 'external_action', blocksStage: true,
    requiredBeforeStages: ['drafts_approved', 'signing_scheduled', 'signing_complete', 'post_execution', 'funding', 'closed'],
  },
  {
    key: 'matter.signing_scheduled', recordType: 'matter', label: 'Signing appointment scheduled',
    source: { kind: 'calendar', field: 'signing_date', confirmation: 'recorded' },
    applicability: { practiceAreas, stages: ['drafts_approved', 'signing_scheduled'], condition: 'Drafts are approved.' },
    severity: 'blocking', owner: 'firm', resolution: 'external_action', blocksStage: true,
    requiredBeforeStages: FROM_EXECUTION,
  },
  {
    key: 'matter.documents_executed', recordType: 'matter', label: 'Execution recorded',
    source: { kind: 'record', field: 'documents_executed_at', confirmation: 'attorney_confirmed' },
    applicability: { practiceAreas, stages: FROM_EXECUTION, condition: 'Signing is complete.' },
    severity: 'blocking', owner: 'attorney', resolution: 'attorney_judgment', blocksStage: true,
    requiredBeforeStages: ['post_execution', 'funding', 'closed'],
  },
  ]
}

export const MATTER_REQUIREMENTS = matterRequirements(ESTATE_PLANNING_PRACTICE_AREAS)
export const COLLEGE_PREPARATION_MATTER_REQUIREMENTS = matterRequirements(
  COLLEGE_PREPARATION_PRACTICE_AREAS,
)

export const ALL_LEAD_REQUIREMENTS: readonly RequirementDefinition[] = [
  ...LEAD_ENGAGEMENT_REQUIREMENTS,
  ...LEAD_WORKFLOW_REQUIREMENTS,
  ...COLLEGE_PREPARATION_LEAD_ENGAGEMENT_REQUIREMENTS,
  ...COLLEGE_PREPARATION_LEAD_WORKFLOW_REQUIREMENTS,
]

export const ALL_MATTER_REQUIREMENTS: readonly RequirementDefinition[] = [
  ...MATTER_REQUIREMENTS,
  ...COLLEGE_PREPARATION_MATTER_REQUIREMENTS,
]

export const ESTATE_PLANNING_REQUIREMENT_REGISTRY = {
  version: LIFECYCLE_REGISTRY_VERSION,
  practiceArea: 'estate_planning',
  lead: [...LEAD_ENGAGEMENT_REQUIREMENTS, ...LEAD_WORKFLOW_REQUIREMENTS],
  matter: MATTER_REQUIREMENTS,
} as const

export const COLLEGE_PREPARATION_REQUIREMENT_REGISTRY = {
  version: LIFECYCLE_REGISTRY_VERSION,
  practiceArea: 'college_preparation',
  lead: [
    ...COLLEGE_PREPARATION_LEAD_ENGAGEMENT_REQUIREMENTS,
    ...COLLEGE_PREPARATION_LEAD_WORKFLOW_REQUIREMENTS,
  ],
  matter: COLLEGE_PREPARATION_MATTER_REQUIREMENTS,
} as const

export const LIFECYCLE_REQUIREMENT_REGISTRIES = [
  ESTATE_PLANNING_REQUIREMENT_REGISTRY,
  COLLEGE_PREPARATION_REQUIREMENT_REGISTRY,
] as const

export function lifecycleRegistrySnapshot() {
  return {
    version: LIFECYCLE_REGISTRY_VERSION,
    registries: LIFECYCLE_REQUIREMENT_REGISTRIES,
  }
}

export function requirementAppliesToPracticeArea(
  requirement: RequirementDefinition,
  practiceArea: unknown,
): boolean {
  // Older rows may not have a practice area yet. Preserve the app's historic
  // estate-planning default for those rows, while never imposing this first
  // registry on an explicitly different practice area.
  const normalized = parsePracticeArea(practiceArea) ?? 'EP'
  return requirement.applicability.practiceAreas.includes(normalized)
}

export function isSuggestionOnlySource(source: RequirementSource): boolean {
  return source.confirmation === 'suggestion_only'
    || source.kind === 'document_extraction'
    || source.kind === 'communication_extraction'
}
