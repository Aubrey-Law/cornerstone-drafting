import { describe, expect, it } from 'vitest'

import { getDraftSetupBlockers, getStageSetupBlockers } from '@/lib/matterSetup'
import type { PipelineMatter } from '@/types/database'

function matter(overrides: Partial<PipelineMatter> = {}): PipelineMatter {
  return {
    stage: 'intake',
    status: 'active',
    matter_created: '2026-06-01T12:00:00.000Z',
    matter_id: 'matter-1',
    client_email: 'avery@example.com',
    client_name: 'Avery Smith',
    marital_status: 'Single',
    spouse_name: null,
    fee_amount: null,
    estimated_value: 1_000_000,
    tax_exposure: 0,
    plan_type: null,
    client_user_id: null,
    matter_name: 'Avery Smith Estate Planning',
    next_appointment: null,
    next_appointment_type: null,
    opened_at: '2026-06-01T12:00:00.000Z',
    practice_area: null,
    referral_source: null,
    spouse_email: null,
    ...overrides,
  } as PipelineMatter
}

describe('matter setup requirements', () => {
  it('returns no draft setup blockers in lite', () => {
    expect(getDraftSetupBlockers(null, matter())).toEqual([])
  })

  it('returns no stage setup blockers in lite', () => {
    expect(getStageSetupBlockers('signing_scheduled', null, matter())).toEqual([])
  })
})
