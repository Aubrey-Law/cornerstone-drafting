import { STAGES, type MatterStage, type StageGroup } from '@/types/database'

/** Board columns and stage-group filter chips collapse the 11 stages into these 5. */
export const STAGE_GROUP_ORDER: StageGroup[] = ['early', 'active', 'work', 'done', 'closed']

export const STAGE_GROUP_LABELS: Record<StageGroup, string> = {
  early: 'Design preparation',
  active: 'Drafting',
  work: 'Client work',
  done: 'Signing',
  closed: 'Closed',
}

/** Dropping on a column moves the matter to that group's first stage. */
export function firstStageOfGroup(group: StageGroup): MatterStage {
  // Historical intake-stage matters remain discoverable; new moves start at Design.
  if (group === 'early') return 'design'
  return (STAGES.find(stage => stage.group === group) ?? STAGES[0]).key
}
