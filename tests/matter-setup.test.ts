import { describe, expect, it } from 'vitest'

import { getDraftSetupBlockers } from '@/lib/matterSetup'
import type { PipelineMatter } from '@/types/database'
import type { MatterDetailsRow } from '@/types/matter-details'

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
    fee_amount: 4_000,
    estimated_value: 1_000_000,
    tax_exposure: 0,
    plan_type: 'Revocable Trust',
    client_user_id: null,
    matter_name: 'Avery Smith Estate Planning',
    next_appointment: null,
    next_appointment_type: null,
    opened_at: '2026-06-01T12:00:00.000Z',
    practice_area: 'EP-LP',
    referral_source: null,
    spouse_email: null,
    ...overrides,
  } as PipelineMatter
}

describe('matter setup requirements', () => {
  it('does not require Legal Plan ID for EP-LP setup blockers', () => {
    const details = {
      practice_area: 'EP-LP',
      plan_type: 'Revocable Trust',
      client_status: 'active',
      matter_status: 'active',
      flat_fee_amount: 4_000,
      responsible_attorney: 'Scott Aubrey',
      jurisdiction_state: 'MA',
      legal_plan: 'MetLife',
      legal_plan_id: null,
    } as MatterDetailsRow

    expect(getDraftSetupBlockers(details, matter())).not.toContain('Legal Plan ID')
  })
})
