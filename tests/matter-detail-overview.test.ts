import { describe, expect, it } from 'vitest'
import { computeMatterNextAction, matterDaysOpen } from '@/lib/matterNextAction'
import type { IntakeReadinessFlag } from '@/lib/intakeReadiness'
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

describe('matter next action — engagement', () => {
  const intakeSent = {
    intake_status: 'sent',
    intake_sent_at: new Date().toISOString(),
  }

  it('keeps send-intake as the top priority', () => {
    const action = computeMatterNextAction(baseMatter(), {
      signed: false,
      sentAt: null,
      status: null,
    })
    expect(action.kind).toBe('send-intake')
  })

  it('prompts send-engagement once intake is out but engagement never sent', () => {
    const action = computeMatterNextAction(baseMatter({
      ...intakeSent,
      intake_status: 'completed',
    }), {
      signed: false,
      sentAt: null,
      status: null,
    })
    expect(action.kind).toBe('send-engagement')
    expect(action.cta).toBe('Send engagement')
    expect(action.tone).toBe('warning')
  })

  it('prompts send-engagement again after a decline', () => {
    const action = computeMatterNextAction(baseMatter({
      ...intakeSent,
      intake_status: 'completed',
    }), {
      signed: false,
      sentAt: new Date().toISOString(),
      status: 'declined',
    })
    expect(action.kind).toBe('send-engagement')
    expect(action.detail).toContain('declined')
  })

  it('waits on the signature after sending', () => {
    const action = computeMatterNextAction(
      baseMatter({ stage: 'drafting', intake_status: 'completed', intake_sent_at: new Date().toISOString() }),
      { signed: false, sentAt: new Date().toISOString(), status: 'sent' },
    )
    expect(action.kind).toBe('waiting-engagement')
    expect(action.cta).toBe('Resend engagement')
  })

  it('falls through to drafting once signed', () => {
    const action = computeMatterNextAction(
      baseMatter({ stage: 'drafting', intake_status: 'completed', intake_sent_at: new Date().toISOString() }),
      { signed: true, sentAt: new Date().toISOString(), status: 'signed' },
    )
    expect(action.kind).toBe('draft')
  })

  it('is unchanged when no engagement snapshot is provided', () => {
    const action = computeMatterNextAction(
      baseMatter({ stage: 'drafting', intake_status: 'completed', intake_sent_at: new Date().toISOString() }),
    )
    expect(action.kind).toBe('draft')
  })

  it('waits for incomplete intake before prompting for engagement', () => {
    const action = computeMatterNextAction(baseMatter(intakeSent), {
      signed: false,
      sentAt: null,
      status: null,
    })
    expect(action.kind).toBe('waiting-intake')
  })

  it('prioritizes review flags over generic drafting', () => {
    const flags: IntakeReadinessFlag[] = [{
      key: 'county_missing',
      label: 'County',
      sectionId: 'personal',
      severity: 'review',
      resolutionKind: 'needs_data',
      message: 'County was not provided.',
    }]
    const action = computeMatterNextAction(
      baseMatter({
        stage: 'drafting',
        intake_status: 'completed',
        intake_sent_at: new Date().toISOString(),
      }),
      { signed: true, sentAt: new Date().toISOString(), status: 'signed' },
      flags,
    )
    expect(action.kind).toBe('resolve-review-flags')
    expect(action.href).toContain('step=design')
    expect(action.href).toContain('focus=client-information%3Acounty')
  })
})


describe('matter lifecycle next actions', () => {
  it.each(['closed', 'archived'])('does not restart work on a %s matter', status => {
    const action = computeMatterNextAction(baseMatter({ status }))
    expect(action.kind).toBe('closed')
    expect(action.href).toBe('/admin/matters/m1?tab=documents')
  })
  it.each([
    ['client_review', 'review'], ['revision', 'revise'],
    ['drafts_approved', 'signing'], ['signing_scheduled', 'signing'],
    ['signing_complete', 'follow-up'], ['post_execution', 'follow-up'], ['funding', 'follow-up'],
  ] as const)('offers stage-appropriate work for %s', (stage, kind) => {
    expect(computeMatterNextAction(baseMatter({stage, intake_status:null})).kind).toBe(kind)
  })
})
