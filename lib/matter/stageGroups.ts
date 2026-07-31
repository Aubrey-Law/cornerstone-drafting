import { STAGES, type MatterStage, type StageGroup } from '@/types/database'

/** Board columns and stage-group filter chips collapse the 11 stages into these 5. */
export const STAGE_GROUP_ORDER: StageGroup[] = ['early', 'active', 'work', 'done', 'closed']

export const STAGE_GROUP_LABELS: Record<StageGroup, string> = {
  early: 'Intake',
  active: 'Drafting',
  work: 'Client work',
  done: 'Signing',
  closed: 'Closed',
}

/** Dropping on a column moves the matter to that group's first stage. */
export function firstStageOfGroup(group: StageGroup): MatterStage {
  return (STAGES.find(stage => stage.group === group) ?? STAGES[0]).key
}
