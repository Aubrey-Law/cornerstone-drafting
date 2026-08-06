/** Engine stage keys and display labels (matter-only). */

import { PIPELINE_TO_ENGINE, type MatterEngineKey, type MatterPipelineStage } from '@/types/database'

export const ENGINE_STAGE_LABELS: Record<string, string> = {
  design_input: 'Design Input',
  design: 'Design',
  drafting: 'Drafting',
  client_review: 'Client Review',
  revisions: 'Revisions',
  approved: 'Approved',
  signing_scheduled: 'Signing Scheduled',
  closeout: 'Closeout',
  funding: 'Funding',
  matter_closed: 'Closed',
}

export function engineStageLabel(key: string): string {
  return ENGINE_STAGE_LABELS[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

/**
 * Map a pipeline stage to its engine key — the TypeScript side of the SQL
 * function `map_matter_stage_to_engine()`. One table, not two switch
 * statements: they drifted once, and a test now asserts they agree.
 */
export function mapMatterStageToEngine(stage: string): MatterEngineKey | null {
  return PIPELINE_TO_ENGINE[stage as MatterPipelineStage] ?? null
}
