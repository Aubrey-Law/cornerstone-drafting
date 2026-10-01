import { describe, expect, it } from 'vitest'
import {
  evaluateMatterRequirements,
  LEAD_REQUIRED_FIELD_KEYS,
  LIFECYCLE_REGISTRY_VERSION,
  matterOperationalBrief,
} from '@/lib/lifecycle/requirements'
import { computeMatterNextAction } from '@/lib/matterNextAction'
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
    ...overrides,
  } as unknown as PipelineMatter)
}

describe('versioned lifecycle requirement registry', () => {
  it('owns the lead engagement gate fields', () => {
    expect(LIFECYCLE_REGISTRY_VERSION).toBe('estate-planning-v1')
    expect(LEAD_REQUIRED_FIELD_KEYS).toEqual([
      'firstName', 'email', 'address', 'maritalStatus', 'spouse', 'practiceArea', 'fee',
    ])
  })

  it('keeps matter next action and operational blockers on the same evaluation', () => {
    const record = matter()
    const requirements = evaluateMatterRequirements(record)
    const action = computeMatterNextAction(record)
    const brief = matterOperationalBrief(record)
    expect(requirements.find(item => item.key === 'intake_sent')?.satisfied).toBe(false)
    expect(action.kind).toBe('send-intake')
    expect(brief.blockers.map(item => item.key)).toContain('intake_sent')
  })

  it('distinguishes client-owned waiting from attorney judgment', () => {
    const record = matter({ intake_status: 'submitted', intake_sent_at: '2026-09-02T12:00:00Z' })
    const flags = [{ key: 'choice', label: 'Resolve trust choice', message: 'Discuss', resolutionKind: 'attorney_judgment' }] as never
    const brief = matterOperationalBrief(record, undefined, flags)
    expect(brief.attorneyDecision).toContain('Intake and design conflicts resolved')
    expect(brief.clientFollowUp).not.toContain('Intake and design conflicts resolved')
  })
})
