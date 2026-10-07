import type { MatterDetailsRow } from '@/types/matter-details'

/**
 * Where a probate matter stands, read from the dates on the record.
 *
 * A probate matter does not move through the estate-planning stages: it has no
 * design meeting, no drafts and no signing. Its progress is a run of court and
 * statutory events, each of which is already a date on `matter_details`. So
 * the probate stage is not stored or set by hand; it is the furthest event the
 * record shows, and it moves when the attorney records the date. Nothing here
 * touches `matters.stage`, which keeps its own vocabulary for the pipeline.
 *
 * Pure, so the stage, the gaps and the next step are tested without a database.
 */

export const PROBATE_STAGE_KEYS = [
  'probate_opening',
  'probate_petition_filed',
  'probate_appointed',
  'probate_inventory_filed',
  'probate_claims_closed',
  'probate_distributed',
  'probate_closed',
] as const
export type ProbateStage = (typeof PROBATE_STAGE_KEYS)[number]

type ProbateFacts = Pick<MatterDetailsRow,
  | 'pb_petition_filed_date'
  | 'pb_pr_appointment_date'
  | 'pb_letters_issued_date'
  | 'pb_inventory_filed_date'
  | 'pb_claims_period_end_date'
  | 'pb_final_distribution_date'
  | 'pb_estate_closed'
  | 'pb_estate_closed_date'
>

interface StageDefinition {
  key: ProbateStage
  /** The firm's name for the stage. */
  label: string
  /** What the client reads in the portal once the stage is reached. */
  clientLabel: string
  /** The date that puts the matter here, or null while it has not happened. */
  reachedOn: (facts: Partial<ProbateFacts>, today: string) => string | null
  /** What the firm does to move the matter on from here. */
  nextStep: string | null
}

const day = (value: string | null | undefined): string | null =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null

const earliest = (...values: Array<string | null>): string | null =>
  values.filter((value): value is string => value !== null).sort()[0] ?? null

export const PROBATE_STAGES: readonly StageDefinition[] = [
  {
    key: 'probate_opening',
    label: 'Opening',
    clientLabel: 'Matter opened',
    reachedOn: () => null,
    nextStep: 'Prepare and file the petition, then record the filing date.',
  },
  {
    key: 'probate_petition_filed',
    label: 'Petition filed',
    clientLabel: 'Petition filed with the court',
    reachedOn: facts => day(facts.pb_petition_filed_date),
    nextStep: 'Track the appointment, then record the appointment or letters date.',
  },
  {
    key: 'probate_appointed',
    label: 'Appointed',
    clientLabel: 'Representative appointed',
    reachedOn: facts => earliest(day(facts.pb_pr_appointment_date), day(facts.pb_letters_issued_date)),
    nextStep: 'Gather the assets and file the inventory, then record the filing date.',
  },
  {
    key: 'probate_inventory_filed',
    label: 'Inventory filed',
    clientLabel: 'Inventory filed',
    reachedOn: facts => day(facts.pb_inventory_filed_date),
    nextStep: 'Review creditor claims until the claims period ends.',
  },
  {
    key: 'probate_claims_closed',
    label: 'Claims period over',
    clientLabel: 'Creditor claims period over',
    reachedOn: (facts, today) => {
      const end = day(facts.pb_claims_period_end_date)
      return end && end <= today ? end : null
    },
    nextStep: 'Prepare the accounting and make distributions, then record the final distribution date.',
  },
  {
    key: 'probate_distributed',
    label: 'Distributed',
    clientLabel: 'Final distribution made',
    reachedOn: facts => day(facts.pb_final_distribution_date),
    nextStep: 'File the closing statement or final account, then mark the estate closed.',
  },
  {
    key: 'probate_closed',
    label: 'Closed',
    clientLabel: 'Estate closed',
    reachedOn: facts => day(facts.pb_estate_closed_date) ?? (facts.pb_estate_closed === true ? 'recorded' : null),
    nextStep: null,
  },
]

export const PROBATE_STAGE_LABEL: Record<ProbateStage, string> = Object.fromEntries(
  PROBATE_STAGES.map(stage => [stage.key, stage.label]),
) as Record<ProbateStage, string>

export interface ProbateStageStep {
  key: ProbateStage
  label: string
  clientLabel: string
  /** The date the record shows, 'recorded' for a closed flag without a date, or null. */
  reachedOn: string | null
  state: 'done' | 'current' | 'upcoming' | 'gap'
}

export interface ProbateStageReading {
  stage: ProbateStage
  label: string
  nextStep: string | null
  steps: ProbateStageStep[]
  /** Earlier events the record does not show although a later one is recorded. */
  gaps: ProbateStage[]
}

/**
 * The stage is the furthest event on the record. An earlier event with no date
 * is a gap, not assumed done: the record is what the court and the deadlines
 * read from, so a missing inventory date is something to fix, not to infer.
 */
export function readProbateStage(facts: Partial<ProbateFacts> | null | undefined, today: string): ProbateStageReading {
  const reached = PROBATE_STAGES.map(stage => stage.reachedOn(facts ?? {}, today))
  let currentIndex = 0
  reached.forEach((date, index) => { if (date !== null) currentIndex = index })
  const steps: ProbateStageStep[] = PROBATE_STAGES.map((stage, index) => ({
    key: stage.key,
    label: stage.label,
    clientLabel: stage.clientLabel,
    reachedOn: reached[index],
    state: index === currentIndex
      ? 'current'
      : index > currentIndex
        ? 'upcoming'
        : index === 0 || reached[index] !== null ? 'done' : 'gap',
  }))
  const current = PROBATE_STAGES[currentIndex]
  return {
    stage: current.key,
    label: current.label,
    nextStep: current.nextStep,
    steps,
    gaps: steps.filter(step => step.state === 'gap').map(step => step.key),
  }
}
