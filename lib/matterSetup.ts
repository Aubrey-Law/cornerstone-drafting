import type { PipelineMatter, MatterStage } from '@/types/database'
import type { MatterDetailsRow } from '@/types/matter-details'

/** Cornerstone Lite does not gate drafting on matter-details setup fields. */
export function getDraftSetupBlockers(_details: MatterDetailsRow | null, _matter: PipelineMatter) {
  return []
}

export function getStageSetupBlockers(
  _stage: MatterStage,
  _details: MatterDetailsRow | null,
  _matter: PipelineMatter
) {
  return []
}
