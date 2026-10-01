import { describe, expect, it } from 'vitest'
import {
  ESTATE_PLANNING_REQUIREMENT_REGISTRY,
  evaluateLeadRequirements,
  evaluateMatterRequirements,
  LEAD_REQUIRED_FIELD_KEYS,
  LIFECYCLE_REGISTRY_VERSION,
  matterOperationalBrief,
  matterStageTransitionPreflight,
} from '@/lib/lifecycle/requirements'
import { leadOperationalBrief } from '@/lib/lifecycle/lead'
import {
  confirmFactSuggestion,
  extractedFactSuggestion,
  factCanSatisfyRequirement,
} from '@/lib/lifecycle/factEvidence'
import { computeMatterNextAction } from '@/lib/matterNextAction'
import { computeNextAction } from '@/lib/leads/nextAction'
import { leadQueueAction } from '@/lib/queries/today'
import type { LeadDetailRecord } from '@/lib/leads/viewTypes'
import type { MatterAgingRow } from '@/lib/queries/pipelineAging'
import type { PipelineMatter } from '@/types/database'

function matter(overrides: Partial<PipelineMatter> = {}): PipelineMatter {
  return ({
    matter_id: '10000000-0000-4000-8000-000000000001', matter_name: 'Estate plan',
    stage: 'intake', status: 'active', flags: null, matter_created: '2026-09-01T12:00:00Z',
    client_name: 'Client', client_email: 'client@example.com', client_phone: '5555555555',
    client_dob: null, client_address: null, spouse_name: null, spouse_email: null,
    spouse_phone: null, spouse_dob: null, spouse_address: null, plan_type: null,
    marital_status: null, has_minor_children: null, taxable_estate: null,
    intake_status: null, intake_sent_at: null, design_status: null,
    intake_submitted_at: null, drafts_sent_at: null, signing_date: null,
    documents_executed_at: null, next_appointment: null, next_appointment_type: null,
    practice_area: 'EP',
    ...overrides,
  } as unknown as PipelineMatter)
}

function lead(overrides: Partial<LeadDetailRecord> = {}): LeadDetailRecord {
  return {
    id: 'lead-1', first_name: 'Ada', middle_name: null, last_name: 'Lovelace', preferred_name: null,
    full_name: 'Ada Lovelace', email: 'ada@example.com', phone: null, date_of_birth: null,
    address_line1: '1 Main St', address_line2: null, city: 'Boston', state: 'MA', zip: '02108',
    county: null, marital_status: 'single', practice_area: 'EP', lead_source: null,
    lead_status: 'lead', engagement_fee_quoted: 4500, intake_sent_at: null,
    intake_completed_at: null, engagement_status: null, engagement_sent_at: null,
    engagement_signed_at: null,
    ...overrides,
  }
}

describe('versioned lifecycle requirement registry', () => {
  it('declares the source, applicability, severity, ownership, resolution and stage policy', () => {
    expect(LIFECYCLE_REGISTRY_VERSION).toBe('estate-planning-v2')
    expect(LEAD_REQUIRED_FIELD_KEYS).toEqual([
      'firstName', 'email', 'address', 'maritalStatus', 'spouse', 'practiceArea', 'fee',
    ])
    for (const requirement of [
      ...ESTATE_PLANNING_REQUIREMENT_REGISTRY.lead,
      ...ESTATE_PLANNING_REQUIREMENT_REGISTRY.matter,
    ]) {
      expect(requirement.source.field).toBeTruthy()
      expect(requirement.source.confirmation).toBeTruthy()
      expect(requirement.applicability.condition).toBeTruthy()
      expect(requirement.applicability.practiceAreas).toContain('EP')
      expect(requirement.severity).toBeTruthy()
      expect(requirement.owner).toBeTruthy()
      expect(requirement.resolution).toBeTruthy()
      expect(typeof requirement.blocksStage).toBe('boolean')
    }
  })

  it('uses the lead rail predicates instead of duplicating field completeness', () => {
    const requirements = evaluateLeadRequirements(lead({ marital_status: 'married' }), null)
    expect(requirements.find(item => item.key === 'lead.spouse')).toMatchObject({ satisfied: false })
    expect(requirements.find(item => item.key === 'lead.firstName')).toMatchObject({ satisfied: true })
  })

  it('keeps matter next action and operational blockers on the same evaluation', () => {
    const record = matter()
    const requirements = evaluateMatterRequirements(record)
    const action = computeMatterNextAction(record)
    const brief = matterOperationalBrief(record)
    expect(requirements.find(item => item.key === 'matter.intake_sent')?.satisfied).toBe(false)
    expect(action.kind).toBe('send-intake')
    expect(brief.blockers.map(item => item.key)).toContain('matter.intake_sent')
  })

  it('distinguishes client-owned missing data from attorney judgment and conflicts', () => {
    const record = matter({
      stage: 'design', intake_status: 'submitted', intake_sent_at: '2026-09-02T12:00:00Z',
      design_status: 'ready',
    })
    const flags = [{
      key: 'choice', label: 'Resolve trust choice', message: 'Discuss',
      resolutionKind: 'attorney_judgment',
    }] as never
    const brief = matterOperationalBrief(record, undefined, flags)
    expect(brief.attorneyDecision).toContain('Intake and design conflicts resolved')
    expect(brief.attorneyDecision).toContain('Resolve trust choice')
    expect(brief.clientFollowUp).not.toContain('Intake and design conflicts resolved')
    expect(brief.conflicts).toEqual(['Resolve trust choice'])
  })

  it('does not apply the estate-planning registry to an explicit different practice area', () => {
    expect(evaluateMatterRequirements(matter({ practice_area: 'Probate' }))).toEqual([])
    expect(evaluateLeadRequirements(lead({ practice_area: 'CP' }), null)).toEqual([])
  })

  it('keeps ordinary client data gaps out of the conflicts section', () => {
    const brief = matterOperationalBrief(matter({ stage: 'design' }), undefined, [{
      key: 'county_missing', label: 'County', message: 'County is missing', sectionId: 'personal',
      severity: 'review', resolutionKind: 'needs_data',
    }])
    expect(brief.missing).toContain('County')
    expect(brief.clientFollowUp).toContain('County')
    expect(brief.conflicts).not.toContain('County')
  })
})

describe('lifecycle parity and safety', () => {
  it('returns blockers before a forward stage transition and none for a correction backward', () => {
    const record = matter({ stage: 'intake' })
    const forward = matterStageTransitionPreflight(record, 'design')
    expect(forward.requiresConfirmation).toBe(true)
    expect(forward.blockers.map(item => item.key)).toEqual([
      'matter.intake_sent', 'matter.intake_complete',
    ])
    expect(matterStageTransitionPreflight({ ...record, stage: 'design' }, 'intake').blockers).toEqual([])
  })

  it('gives Today the same lead action as the lead record for the same state', () => {
    const input = {
      leadStatus: 'lead', intakeSentAt: null, intakeCompletedAt: null,
      nextAppointmentAt: null, feeQuoted: null, hasActiveAgreement: false,
      engagementStatus: null, engagementSentAt: null, engagementSignedAt: null,
      discoveryCallAt: null, planningSessionAt: null, lastTouchAt: '2026-09-01T12:00:00Z',
    }
    const recordAction = computeNextAction(input)
    const todayAction = leadQueueAction({
      entity: 'lead', id: 'lead-1', current_stage: 'new_lead', is_scheduled: false,
    } as MatterAgingRow, {
      id: 'lead-1', lead_status: input.leadStatus, intake_sent_at: input.intakeSentAt,
      intake_completed_at: input.intakeCompletedAt, next_appointment_at: input.nextAppointmentAt,
      engagement_fee_quoted: input.feeQuoted, engagement_status: input.engagementStatus,
      engagement_sent_at: input.engagementSentAt, engagement_signed_at: input.engagementSignedAt,
      last_activity_at: input.lastTouchAt, updated_at: input.lastTouchAt,
    })
    expect(todayAction).toMatchObject({ kind: recordAction.key, title: recordAction.title })
  })

  it('keeps extracted facts suggestion-only until an identified user confirms them', () => {
    const suggestion = extractedFactSuggestion({
      key: 'beneficiary.name', value: 'Person named in an uploaded document', origin: 'document_extraction',
    })
    expect(factCanSatisfyRequirement(suggestion)).toBe(false)
    expect(() => confirmFactSuggestion(suggestion, '')).toThrow('confirming actor')
    const confirmed = confirmFactSuggestion(suggestion, 'attorney-1', '2026-10-01T12:00:00Z')
    expect(confirmed).toMatchObject({ status: 'confirmed', confirmedBy: 'attorney-1' })
    expect(factCanSatisfyRequirement(confirmed)).toBe(true)
  })

  it('does not present draft intake values as confirmed operational facts', () => {
    const record = lead({ status: 'draft', intake_sent_at: '2026-09-01T12:00:00Z' })
    const action = computeNextAction({
      leadStatus: 'lead', intakeSentAt: record.intake_sent_at ?? null,
      intakeCompletedAt: null, nextAppointmentAt: null, feeQuoted: 4500,
      hasActiveAgreement: false, lastTouchAt: null,
    })
    const brief = leadOperationalBrief({ lead: record, spouse: null, nextAction: action })
    expect(brief.known).not.toContain('Client name')
    expect(brief.conflicts[0]).toContain('require review')
  })
})
