import type { PipelineMatter, MatterStage } from '@/types/database'
import type { MatterDetailsRow } from '@/types/matter-details'
import { normalizePracticeArea } from '@/lib/practiceArea'

function hasText(value: unknown) {
  return typeof value === 'string' ? value.trim().length > 0 : value !== null && value !== undefined
}

function hasJurisdiction(details: MatterDetailsRow | null) {
  return hasText(details?.jurisdiction_state)
}

export function getDraftSetupBlockers(details: MatterDetailsRow | null, matter: PipelineMatter) {
  const practiceArea = normalizePracticeArea(details?.practice_area ?? matter.practice_area)
  const blockers: string[] = []

  if (!practiceArea) blockers.push('Practice Area')
  if (!hasText(details?.plan_type ?? matter.plan_type)) blockers.push('Plan Type')
  if (!hasText(details?.client_status ?? matter.status)) blockers.push('Client Relationship')
  if (!hasText(details?.matter_status)) blockers.push('Matter Status')
  if (!hasJurisdiction(details)) blockers.push('Jurisdiction')

  if (practiceArea === 'EP-LP') {
    if (!hasText(details?.legal_plan)) blockers.push('Legal Plan')
  }

  if (practiceArea === 'Probate') {
    if (!hasText(details?.pb_decedent_name)) blockers.push('Decedent Name')
    if (!hasText(details?.pb_court_name)) blockers.push('Court')
    if (!hasText(details?.pb_probate_type)) blockers.push('Probate Type')
  }

  return blockers
}

export function getStageSetupBlockers(
  stage: MatterStage,
  details: MatterDetailsRow | null,
  matter: PipelineMatter
) {
  const blockers = getDraftSetupBlockers(details, matter)

  if (stage === 'signing_scheduled' && !hasText(details?.scheduled_signing_date ?? matter.signing_date)) {
    blockers.push('Scheduled Signing Date')
  }

  if (['signing_complete', 'post_execution', 'closed'].includes(stage)) {
    if (!hasText(details?.signing_date ?? matter.signing_date)) blockers.push('Signing Date')
  }

  if (['post_execution', 'closed'].includes(stage) && !hasText(details?.documents_filed_date)) {
    blockers.push('Documents Filed Date')
  }

  return Array.from(new Set(blockers))
}
