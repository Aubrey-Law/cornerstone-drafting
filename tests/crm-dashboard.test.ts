import { describe, expect, it } from 'vitest'
import { buildCrmDashboard, isConverted, isPipelinePerson } from '@/lib/crm/dashboard'
import type { CrmPeopleRow, CrmStageRow } from '@/lib/queries/cornerstoneCrm'

const NOW = new Date('2026-08-06T16:00:00.000Z')

function stage(overrides: Partial<CrmStageRow> & { id: string; name: string }): CrmStageRow {
  return {
    slug: overrides.name.toLowerCase(),
    sort_order: 0,
    is_active: true,
    is_closed: false,
    is_won: false,
    ...overrides,
  }
}

const stages: CrmStageRow[] = [
  stage({ id: 'stage-new', name: 'New Inquiry', sort_order: 1 }),
  stage({ id: 'stage-qualified', name: 'Qualified', sort_order: 2 }),
  stage({ id: 'stage-won', name: 'Hired', sort_order: 3, is_closed: true, is_won: true }),
  stage({ id: 'stage-lost', name: 'Closed Lost', sort_order: 4, is_closed: true }),
  stage({ id: 'stage-retired', name: 'Retired stage', sort_order: 5, is_active: false }),
]

function person(overrides: Partial<CrmPeopleRow> & { id: string }): CrmPeopleRow {
  return {
    sourceSystem: 'cornerstone',
    personKind: 'primary',
    name: 'Person',
    email: null,
    phone: null,
    mobilePhone: null,
    company: null,
    jobTitle: null,
    city: null,
    state: null,
    country: null,
    leadSource: null,
    referralSource: null,
    lifecycleStatus: null,
    ownerUserId: null,
    assignedToUserId: null,
    nextFollowUpAt: null,
    lastEngagementAt: null,
    campaignOptOut: null,
    syncState: null,
    stageId: null,
    stageName: null,
    stageSlug: null,
    stageEnteredAt: null,
    twentyContactId: null,
    sourceRecordId: null,
    sourceRecordHref: null,
    sourceRecordLabel: null,
    lastSyncedAt: null,
    createdAt: '2026-08-02T12:00:00.000Z',
    updatedAt: '2026-08-02T12:00:00.000Z',
    ...overrides,
  }
}

const people: CrmPeopleRow[] = [
  person({ id: 'p1', name: 'Chen, Marcus', stageId: 'stage-new', leadSource: 'referral', createdAt: '2026-08-01T12:00:00.000Z' }),
  person({ id: 'p2', name: 'Rivera, Ana', stageId: 'stage-qualified', leadSource: 'Referral', createdAt: '2026-08-03T12:00:00.000Z' }),
  person({ id: 'p3', name: 'Okafor, Ada', stageId: 'stage-won', leadSource: 'seminar', createdAt: '2026-08-04T12:00:00.000Z' }),
  person({ id: 'p4', name: 'Silva, Rui', stageId: 'stage-lost', leadSource: 'web', createdAt: '2026-07-10T12:00:00.000Z' }),
  person({ id: 'p5', name: 'Novak, Ivan', lifecycleStatus: 'converted', createdAt: '2026-07-12T12:00:00.000Z' }),
  person({ id: 'p6', name: 'Park, Sun', createdAt: '2026-07-15T12:00:00.000Z' }),
]

function snapshot() {
  return buildCrmDashboard({ people, stages, now: NOW })
}

describe('crm dashboard', () => {
  it('counts open pipeline as everything outside a closed stage', () => {
    // p1, p2 (open stages) and p5, p6 (no stage at all).
    expect(snapshot().activePipeline.count).toBe(4)
    expect(snapshot().people.count).toBe(6)
  })

  it('treats a won stage or a converted lifecycle as converted', () => {
    const wonStageIds = new Set(['stage-won'])
    expect(isConverted(people[2], wonStageIds)).toBe(true)
    expect(isConverted(people[4], wonStageIds)).toBe(true)
    expect(isConverted(people[3], wonStageIds)).toBe(false)
    expect(snapshot().conversion).toEqual({ percent: 33, converted: 2, total: 6 })
  })

  it('compares this month against the prior month', () => {
    // Three added in August, three in July.
    expect(snapshot().people).toMatchObject({
      newThisMonth: 3,
      newPriorMonth: 3,
      deltaPercent: 0,
    })
  })

  it('folds lead sources case-insensitively and names the unattributed', () => {
    const sources = snapshot().leadSources
    expect(sources[0]).toMatchObject({ key: 'referral', label: 'Referral', count: 2 })
    expect(sources.find(slice => slice.key === 'unknown')).toMatchObject({
      label: 'Unattributed',
      count: 2,
    })
    expect(sources.reduce((sum, slice) => sum + slice.count, 0)).toBe(people.length)
  })

  it('orders the pipeline by stage sort order and drops inactive stages', () => {
    expect(snapshot().pipeline.map(entry => entry.label)).toEqual([
      'New Inquiry', 'Qualified', 'Hired', 'Closed Lost',
    ])
    expect(snapshot().pipeline.find(entry => entry.label === 'Hired')?.isWon).toBe(true)
  })

  it('splits follow-ups into overdue, today, and upcoming', () => {
    const withFollowUps = buildCrmDashboard({
      stages,
      now: NOW,
      people: [
        person({ id: 'f1', nextFollowUpAt: '2026-08-01T12:00:00.000Z' }),
        person({ id: 'f2', nextFollowUpAt: '2026-08-06T15:00:00.000Z' }),
        person({ id: 'f3', nextFollowUpAt: '2026-08-20T12:00:00.000Z' }),
        person({ id: 'f4' }),
      ],
    })
    expect(withFollowUps.followUps).toEqual({ overdue: 1, dueToday: 1, upcoming: 1 })
  })

  it('lists the newest people first', () => {
    expect(snapshot().recentPeople.map(entry => entry.id)).toEqual([
      'p3', 'p2', 'p1', 'p6', 'p5', 'p4',
    ])
  })
})

describe('crm dashboard funnel scope', () => {
  // The contact sync writes a person for every spouse, child and fiduciary,
  // pinned at the first stage and never advanced. Counting them as leads put
  // people who cannot convert into the denominator.
  const related = [
    person({ id: 'spouse', personKind: 'related', stageId: 'stage-new' }),
    person({ id: 'child', personKind: 'related', stageId: 'stage-new' }),
    person({ id: 'trustee', personKind: 'related', stageId: 'stage-new' }),
    person({ id: 'walk-in', personKind: 'standalone', stageId: 'stage-new' }),
  ]
  const withRelated = () => buildCrmDashboard({ people: [...people, ...related], stages, now: NOW })

  it('identifies which people can move through the pipeline', () => {
    expect(isPipelinePerson(people[0])).toBe(true)
    expect(isPipelinePerson(related[0])).toBe(false)
    expect(isPipelinePerson(related[3])).toBe(false)
  })

  it('keeps related contacts out of the conversion rate (catches a denominator diluted by spouses and fiduciaries)', () => {
    // Same two conversions over the same six leads as without the contacts.
    expect(withRelated().conversion).toEqual({ percent: 33, converted: 2, total: 6 })
  })

  it('keeps related contacts out of the active pipeline', () => {
    expect(withRelated().activePipeline.count).toBe(4)
  })

  it('keeps related contacts out of stage occupancy', () => {
    const newInquiry = withRelated().pipeline.find(entry => entry.label === 'New Inquiry')
    expect(newInquiry?.count).toBe(1)
  })

  it('keeps related contacts out of lead sources', () => {
    const sources = withRelated().leadSources
    expect(sources.reduce((sum, slice) => sum + slice.count, 0)).toBe(people.length)
  })

  it('still counts every contact in the people total and follow-ups', () => {
    // "Total people" is the contact base, not the funnel — related rows belong.
    expect(withRelated().people.count).toBe(10)
    expect(withRelated().recentPeople.length).toBeGreaterThan(people.length)
  })

  it('reports zero rather than dividing by zero when no leads exist', () => {
    const contactsOnly = buildCrmDashboard({ people: related, stages, now: NOW })
    expect(contactsOnly.conversion).toEqual({ percent: 0, converted: 0, total: 0 })
  })
})
