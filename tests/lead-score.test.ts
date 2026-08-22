import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  computeLeadScore,
  LEAD_SCORE_BANDS,
  leadScoreBand,
  leadScoreInputFromRow,
  leadScoreIsActive,
  scoringAppointmentAt,
  topLeadScoreReasons,
  type LeadScoreComponentKey,
  type LeadScoreInput,
} from '@/lib/leads/score'

const baseInput: LeadScoreInput = {
  leadStatus: 'lead',
  intakeSentAt: null,
  intakeCompletedAt: null,
  intakeStatus: null,
  engagementStatus: null,
  engagementSentAt: null,
  engagementSignedAt: null,
  feeQuoted: null,
  billingType: null,
  taxableEstate: null,
  hasMinorChildren: null,
  urgency: null,
  leadSource: null,
  lastTouchAt: null,
  createdAt: null,
  nextAppointmentAt: null,
  readinessPercent: null,
}

function pointsFor(key: LeadScoreComponentKey, overrides: Partial<LeadScoreInput> = {}): number {
  const result = computeLeadScore({ ...baseInput, ...overrides })
  return result.components.find(component => component.key === key)!.points
}

describe('computeLeadScore', () => {
  beforeEach(() => vi.useFakeTimers().setSystemTime(new Date('2026-07-25T16:00:00Z')))
  afterEach(() => vi.useRealTimers())

  it('scores a bare lead at the urgency-not-set and unknown-source floor', () => {
    const result = computeLeadScore(baseInput)
    // Urgency not set (4) + source not recorded (2); everything else is absent.
    expect(result.score).toBe(6)
    expect(result.band).toBe('cold')
    expect(result.components).toHaveLength(8)
  })

  it('never produces NaN or a negative score from all-null input', () => {
    const result = computeLeadScore({ ...baseInput, leadStatus: null })
    expect(Number.isFinite(result.score)).toBe(true)
    expect(result.score).toBeGreaterThanOrEqual(0)
    for (const component of result.components) {
      expect(Number.isFinite(component.points)).toBe(true)
      expect(component.reason).not.toBe('')
    }
  })

  it('sums component points into the score', () => {
    const result = computeLeadScore({
      ...baseInput,
      engagementSentAt: '2026-07-20T16:00:00Z',
      feeQuoted: 4000,
      urgency: 'high',
    })
    const summed = result.components.reduce((total, component) => total + component.points, 0)
    expect(result.score).toBe(summed)
  })

  it('caps component maxima at exactly 100', () => {
    const maxima = computeLeadScore(baseInput).components.reduce((total, component) => total + component.max, 0)
    expect(maxima).toBe(100)
  })

  it('clamps a maximal lead to 100', () => {
    const result = computeLeadScore({
      ...baseInput,
      engagementSignedAt: '2026-07-24T16:00:00Z',
      feeQuoted: 9000,
      taxableEstate: 4_000_000,
      hasMinorChildren: true,
      urgency: 'high',
      leadSource: 'Client referral',
      lastTouchAt: '2026-07-25T12:00:00Z',
      nextAppointmentAt: '2026-07-30T16:00:00Z',
      readinessPercent: 100,
    })
    expect(result.score).toBe(100)
    expect(result.band).toBe('hot')
  })

  describe('progress', () => {
    it.each([
      ['engagement signed', { engagementSignedAt: '2026-07-20T16:00:00Z' }, 20],
      ['engagement sent', { engagementSentAt: '2026-07-20T16:00:00Z' }, 16],
      ['intake completed', { intakeCompletedAt: '2026-07-20T16:00:00Z' }, 12],
      ['intake status completed', { intakeStatus: 'completed' }, 12],
      ['intake sent', { intakeSentAt: '2026-07-20T16:00:00Z' }, 6],
    ])('awards %s', (_label, overrides, expected) => {
      expect(pointsFor('progress', overrides)).toBe(expected)
    })
  })

  describe('fee', () => {
    it.each([
      [5000, 15],
      [4999, 12],
      [3000, 12],
      [2999, 8],
      [1500, 8],
      [1499, 5],
    ])('awards %d quoted as %d points', (feeQuoted, expected) => {
      expect(pointsFor('fee', { feeQuoted })).toBe(expected)
    })

    it('credits a legal plan member with no quote', () => {
      expect(pointsFor('fee', { billingType: 'metlife' })).toBe(7)
    })

    it('prefers an actual quote over the legal plan floor', () => {
      expect(pointsFor('fee', { feeQuoted: 5000, billingType: 'metlife' })).toBe(15)
    })
  })

  describe('estate', () => {
    it.each([
      [2_000_000, 15],
      [1_999_999, 10],
      [1_000_000, 10],
      [999_999, 5],
    ])('awards %d estate as %d points', (taxableEstate, expected) => {
      expect(pointsFor('estate', { taxableEstate })).toBe(expected)
    })

    it('adds a minor-children bump without exceeding the maximum', () => {
      expect(pointsFor('estate', { taxableEstate: 500_000, hasMinorChildren: true })).toBe(7)
      expect(pointsFor('estate', { taxableEstate: 4_000_000, hasMinorChildren: true })).toBe(15)
    })

    it('credits minor children alone when no estate value is recorded', () => {
      expect(pointsFor('estate', { hasMinorChildren: true })).toBe(2)
    })
  })

  describe('urgency', () => {
    it.each([
      ['high', 10],
      ['normal', 5],
      ['low', 0],
    ])('awards %s as %d points', (urgency, expected) => {
      expect(pointsFor('urgency', { urgency })).toBe(expected)
    })

    it('treats an unset urgency as slightly better than an explicit low', () => {
      expect(pointsFor('urgency')).toBe(4)
    })
  })

  describe('recency', () => {
    it.each([
      ['2026-07-25T09:00:00Z', 15],
      ['2026-07-22T16:00:00Z', 15],
      ['2026-07-21T16:00:00Z', 11],
      ['2026-07-18T16:00:00Z', 11],
      ['2026-07-17T16:00:00Z', 6],
      ['2026-07-11T16:00:00Z', 6],
      ['2026-07-10T16:00:00Z', 2],
      ['2026-06-25T16:00:00Z', 2],
      ['2026-06-24T16:00:00Z', 0],
    ])('scores a touch at %s as %d points', (lastTouchAt, expected) => {
      expect(pointsFor('recency', { lastTouchAt })).toBe(expected)
    })

    it('explains a missing touch', () => {
      const component = computeLeadScore(baseInput).components.find(entry => entry.key === 'recency')!
      expect(component.points).toBe(0)
      expect(component.reason).toBe('No recorded touch')
    })
  })

  describe('appointment', () => {
    it('credits a future meeting in full', () => {
      expect(pointsFor('appointment', { nextAppointmentAt: '2026-07-30T16:00:00Z' })).toBe(10)
    })

    it('credits a meeting today in full', () => {
      expect(pointsFor('appointment', { nextAppointmentAt: '2026-07-25T21:00:00Z' })).toBe(10)
    })

    it('half-credits a meeting already held', () => {
      expect(pointsFor('appointment', { nextAppointmentAt: '2026-07-20T16:00:00Z' })).toBe(5)
    })
  })

  describe('source', () => {
    it.each([
      ['Client referral', 10],
      ['MetLife', 8],
      ['Website', 5],
      ['Seminar', 4],
    ])('scores %s as %d points', (leadSource, expected) => {
      expect(pointsFor('source', { leadSource })).toBe(expected)
    })

    it('scores an unrecorded source below any known one', () => {
      expect(pointsFor('source')).toBe(2)
    })
  })

  describe('readiness', () => {
    it.each([
      [100, 5],
      [80, 4],
      [50, 3],
      [0, 0],
    ])('converts %d%% readiness into %d points', (readinessPercent, expected) => {
      expect(pointsFor('readiness', { readinessPercent })).toBe(expected)
    })

    it('clamps an out-of-range readiness percent', () => {
      expect(pointsFor('readiness', { readinessPercent: 140 })).toBe(5)
      expect(pointsFor('readiness', { readinessPercent: -20 })).toBe(0)
    })
  })
})

describe('leadScoreBand', () => {
  it.each([
    [100, 'hot'],
    [70, 'hot'],
    [69, 'warm'],
    [45, 'warm'],
    [44, 'cool'],
    [25, 'cool'],
    [24, 'cold'],
    [0, 'cold'],
  ])('places %d in the %s band', (score, expected) => {
    expect(leadScoreBand(score)).toBe(expected)
  })

  it('orders bands from hottest to coldest', () => {
    expect(LEAD_SCORE_BANDS.map(band => band.key)).toEqual(['hot', 'warm', 'cool', 'cold'])
  })
})

describe('leadScoreIsActive', () => {
  it.each(['hired', 'lost', 'declined'])('treats a %s lead as inactive', status => {
    expect(leadScoreIsActive(status)).toBe(false)
  })

  it.each(['lead', null, undefined])('treats %s as active', status => {
    expect(leadScoreIsActive(status)).toBe(true)
  })
})

describe('topLeadScoreReasons', () => {
  beforeEach(() => vi.useFakeTimers().setSystemTime(new Date('2026-07-25T16:00:00Z')))
  afterEach(() => vi.useRealTimers())

  it('returns the richest scoring components first and skips empty ones', () => {
    const score = computeLeadScore({
      ...baseInput,
      engagementSignedAt: '2026-07-24T16:00:00Z',
      feeQuoted: 5000,
      urgency: 'low',
      leadSource: null,
    })
    const reasons = topLeadScoreReasons(score)
    expect(reasons.map(reason => reason.key)).toEqual(['progress', 'fee', 'source'])
    expect(reasons.every(reason => reason.points > 0)).toBe(true)
  })
})

describe('scoringAppointmentAt', () => {
  beforeEach(() => vi.useFakeTimers().setSystemTime(new Date('2026-07-25T16:00:00Z')))
  afterEach(() => vi.useRealTimers())

  it('prefers the soonest upcoming anchor over a later one', () => {
    expect(scoringAppointmentAt('2026-08-10T16:00:00Z', '2026-07-28T16:00:00Z'))
      .toBe('2026-07-28T16:00:00Z')
  })

  it('prefers an upcoming anchor over a past one regardless of argument order', () => {
    expect(scoringAppointmentAt('2026-07-01T16:00:00Z', '2026-07-28T16:00:00Z'))
      .toBe('2026-07-28T16:00:00Z')
  })

  it('falls back to the most recent past anchor when none are ahead', () => {
    expect(scoringAppointmentAt('2026-07-01T16:00:00Z', '2026-07-20T16:00:00Z'))
      .toBe('2026-07-20T16:00:00Z')
  })

  it('ignores null and unparseable anchors', () => {
    expect(scoringAppointmentAt(null, undefined, 'not-a-date')).toBeNull()
    expect(scoringAppointmentAt(null, '2026-07-28T16:00:00Z')).toBe('2026-07-28T16:00:00Z')
  })
})

describe('leadScoreInputFromRow', () => {
  it('maps a list row and prefers last_activity_at over updated_at', () => {
    const input = leadScoreInputFromRow({
      id: 'lead-1',
      full_name: 'Dana Reyes',
      first_name: 'Dana',
      last_name: 'Reyes',
      email: null,
      phone: null,
      practice_area: 'estate_planning',
      status: 'completed',
      lead_status: 'lead',
      matter_id: null,
      intake_sent_at: '2026-07-01T16:00:00Z',
      intake_completed_at: '2026-07-05T16:00:00Z',
      engagement_status: null,
      engagement_sent_at: null,
      engagement_signed_at: null,
      engagement_fee_quoted: 3200,
      created_at: '2026-06-30T16:00:00Z',
      updated_at: '2026-07-02T16:00:00Z',
      lead_urgency: 'high',
      taxable_estate: 1_500_000,
      last_activity_at: '2026-07-20T16:00:00Z',
      lead_source: 'Client referral',
      has_minor_children: true,
    })

    expect(input.lastTouchAt).toBe('2026-07-20T16:00:00Z')
    expect(input.intakeStatus).toBe('completed')
    expect(input.feeQuoted).toBe(3200)
    expect(input.taxableEstate).toBe(1_500_000)
    expect(input.hasMinorChildren).toBe(true)
    expect(input.urgency).toBe('high')
  })

  it('lets extras supply values the row does not carry', () => {
    const input = leadScoreInputFromRow(
      {
        id: 'lead-2',
        first_name: null,
        middle_name: null,
        last_name: null,
        preferred_name: null,
        full_name: null,
        email: null,
        phone: null,
        date_of_birth: null,
        address_line1: null,
        address_line2: null,
        city: null,
        state: null,
        zip: null,
        county: null,
        marital_status: null,
        practice_area: null,
        lead_source: null,
        lead_status: 'lead',
        engagement_fee_quoted: null,
      },
      { nextAppointmentAt: '2026-08-01T16:00:00Z', readinessPercent: 60, lastTouchAt: '2026-07-24T16:00:00Z' },
    )

    expect(input.nextAppointmentAt).toBe('2026-08-01T16:00:00Z')
    expect(input.readinessPercent).toBe(60)
    expect(input.lastTouchAt).toBe('2026-07-24T16:00:00Z')
  })

  it('falls back to updated_at when no activity is recorded', () => {
    const input = leadScoreInputFromRow({
      id: 'lead-3',
      full_name: null,
      first_name: null,
      last_name: null,
      email: null,
      phone: null,
      practice_area: null,
      status: null,
      lead_status: 'lead',
      matter_id: null,
      intake_sent_at: null,
      intake_completed_at: null,
      engagement_status: null,
      engagement_sent_at: null,
      engagement_signed_at: null,
      engagement_fee_quoted: null,
      created_at: '2026-06-30T16:00:00Z',
      updated_at: '2026-07-02T16:00:00Z',
      lead_urgency: null,
      taxable_estate: null,
      last_activity_at: null,
    })

    expect(input.lastTouchAt).toBe('2026-07-02T16:00:00Z')
  })
})
