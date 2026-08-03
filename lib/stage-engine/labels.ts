/** Engine stage keys and display labels (matter-only). */

export const ENGINE_STAGE_LABELS: Record<string, string> = {
  design_input: 'Design Input',
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

/** Map legacy matter.stage to engine stage key (mirrors SQL map_matter_stage_to_engine). */
export function mapMatterStageToEngine(stage: string): string | null {
  switch (stage) {
    case 'intake':
    case 'intake_review':
    case 'design':
      return 'design_input'
    case 'drafting':
      return 'drafting'
    case 'client_review':
      return 'client_review'
    case 'revision':
      return 'revisions'
    case 'drafts_approved':
      return 'approved'
    case 'signing_scheduled':
    case 'signing_complete':
      return 'signing_scheduled'
    case 'post_execution':
      return 'closeout'
    case 'funding':
      return 'funding'
    case 'closed':
      return 'matter_closed'
    default:
      return null
  }
}
