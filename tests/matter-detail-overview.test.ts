import { describe, expect, it } from 'vitest'
import { computeMatterNextAction, matterDaysOpen } from '@/lib/matterNextAction'
import type { PipelineMatter } from '@/types/database'

function baseMatter(overrides: Partial<PipelineMatter> = {}): PipelineMatter {
  return {
    matter_id: 'm1',
    matter_name: 'Test',
    stage: 'intake',
    status: '',
    flags: null,
    matter_created: new Date().toISOString(),
    client_name: 'Ada Lovelace',
    client_email: 'ada@example.com',
    client_phone: '',
    client_dob: null,
    client_address: null,
    spouse_name: null,
    spouse_email: null,
    spouse_phone: null,
    spouse_dob: null,
    spouse_address: null,
    plan_type: null,
    marital_status: null,
    has_minor_children: null,
    taxable_estate: null,
    intake_status: null,
    intake_sent_at: null,
    design_status: null,
    intake_submitted_at: null,
    drafts_sent_at: null,
    signing_date: null,
    documents_executed_at: null,
    next_appointment: null,
    next_appointment_type: null,
    practice_area: 'EP',
    referral_source: null,
    fee_amount: null,
    opened_at: null,
    client_status: null,
    ...overrides,
  }
}

describe('matter next action', () => {
  it('prompts send intake when invite not sent', () => {
    const action = computeMatterNextAction(baseMatter())
    expect(action.cta).toBe('Send intake')
    expect(action.kind).toBe('send-intake')
    expect(action.href).toBe('/admin/matters/m1')
  })

  it('opens drafting after intake review', () => {
    const action = computeMatterNextAction(baseMatter({
      stage: 'intake_review',
      intake_status: 'submitted',
      intake_sent_at: new Date().toISOString(),
    }))
    expect(action.href).toBe('/admin/drafting/m1')
    expect(action.cta).toBe('Open drafting')
  })

  it('computes days open from matter_created', () => {
    const created = new Date(Date.now() - 5 * 86_400_000).toISOString()
    expect(matterDaysOpen(created)).toBe(5)
  })
})
