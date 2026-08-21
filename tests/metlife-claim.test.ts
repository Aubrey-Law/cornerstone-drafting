import { describe, expect, it, vi } from 'vitest'
import type { DraftPayload } from '@/lib/draftPayload/types'
import { assembleMetlifeClaim, deriveMetlifePlanType } from '@/lib/metlife/assemble'
import { buildSubmissionRows, generateMetlifeArtifact, metlifeClaimFilename, submissionCsv } from '@/lib/metlife/generate'
import {
  calculateMetlifeScheduleAmount,
  METLIFE_FEES,
  METLIFE_SCHEDULE_ITEMS,
  metlifeInheritanceLitigationFeeCents,
  metlifeProbateFeeCents,
} from '@/lib/metlife/pricing'
import type { MetlifeMatterDetails, MetlifeRunInput } from '@/lib/metlife/types'

const DOCUMENTS = {
  include_trust: true,
  include_pour_over_will: true,
  include_simple_will: false,
  include_testamentary_trust_will: false,
  include_dpoa: true,
  include_hcp: true,
  include_hipaa: true,
  include_ahd: true,
  include_ppm: false,
  include_parental_appointment: false,
  include_temp_delegation: false,
  include_deed: false,
  include_real_estate_trust: false,
}

function payload(overrides: Partial<DraftPayload> = {}, documents: Partial<typeof DOCUMENTS> = {}): DraftPayload {
  return {
    matter: { id: '11111111-1111-4111-8111-111111111111', matter_number: 'EP-100', type: 'married_joint', trust_type: 'revocable_living', practice_area: 'Estate Planning', minor_children: false },
    client: { first_name: 'Alex', last_name: 'Chen', full_name: 'Alex Chen' },
    spouse: { first_name: 'Jamie', last_name: 'Chen', full_name: 'Jamie Chen' },
    trust: { separate_trusts: false },
    documents: { ...DOCUMENTS, ...documents },
    ...overrides,
  } as unknown as DraftPayload
}

const DETAILS: MetlifeMatterDetails = {
  billingType: 'metlife',
  memberId: 'MET-4471',
  serviceStart: '2026-04-01',
  serviceEnd: '2026-04-15',
}

function claim(payloadOverrides: Partial<DraftPayload> = {}, documents: Partial<typeof DOCUMENTS> = {}, input: MetlifeRunInput = {}, details: MetlifeMatterDetails = DETAILS) {
  return assembleMetlifeClaim(payload(payloadOverrides, documents), details, input, new Date('2026-04-20T16:00:00Z'))
}

describe('MetLife plan-type derivation', () => {
  it('reads a joint trust from a joint married design sheet', () => {
    expect(deriveMetlifePlanType(payload())).toBe('joint_trust')
  })

  it('reads separate trusts from the separate-trusts flag', () => {
    expect(deriveMetlifePlanType(payload({ trust: { separate_trusts: true } as DraftPayload['trust'] }))).toBe('separate_trust')
  })

  it('falls back to the matter type when the separate-trusts flag was never set', () => {
    expect(deriveMetlifePlanType(payload({
      matter: { ...payload().matter, type: 'married_individual' },
      trust: null,
    }))).toBe('separate_trust')
  })

  it('drops to a will plan when the matter has no trust', () => {
    expect(deriveMetlifePlanType(payload({}, { include_trust: false }))).toBe('will_couple')
    expect(deriveMetlifePlanType(payload({ spouse: null }, { include_trust: false }))).toBe('will_individual')
  })

  it('reads an individual trust for a single client', () => {
    expect(deriveMetlifePlanType(payload({ spouse: null }))).toBe('individual_trust')
  })
})

describe('MetLife claim totals', () => {
  const willMember = ['Will with support trust/Codicil — Individual - Member', '200', 15_000] as const
  const willSpouse = ['Will with support trust/Codicil — Individual - Spouse', '200', 15_000] as const
  const financialCouple = ['Power of Attorney_Financial — Member and Spouse', '220', 8_500] as const
  const healthCareCouple = ['Power of Attorney_Health Care — Member and Spouse', '220', 8_500] as const
  const livingWillCouple = ['Living Will — Member and Spouse', '230', 6_000] as const
  const financialMember = ['Power of Attorney_Financial — Member', '220', 6_000] as const
  const healthCareMember = ['Power of Attorney_Health Care — Member', '220', 6_000] as const
  const livingWillMember = ['Living Will — Member', '230', 4_500] as const
  const trustCouple = ['Trust — Member and Spouse', '260', 40_000] as const
  const trustMember = ['Trust — Individual - Member', '260', 32_500] as const
  const trustSpouse = ['Trust — Individual - Spouse', '260', 32_500] as const

  it.each([
    ['Couple Joint Trust', () => claim(), 'joint_trust', 93_000, [
      willMember, willSpouse, financialCouple, healthCareCouple, livingWillCouple, trustCouple,
    ]],
    ['Couple Separate Trusts', () => claim({ trust: { separate_trusts: true } as DraftPayload['trust'] }), 'separate_trust', 118_000, [
      willMember, willSpouse, financialCouple, healthCareCouple, livingWillCouple, trustMember, trustSpouse,
    ]],
    ['Couple Will', () => claim({}, { include_trust: false, include_pour_over_will: false, include_simple_will: true }), 'will_couple', 53_000, [
      willMember, willSpouse, financialCouple, healthCareCouple, livingWillCouple,
    ]],
    ['Individual Trust', () => claim({ spouse: null }), 'individual_trust', 64_000, [
      willMember, financialMember, healthCareMember, livingWillMember, trustMember,
    ]],
    ['Individual Will', () => claim({ spouse: null }, { include_trust: false, include_pour_over_will: false, include_simple_will: true }), 'will_individual', 31_500, [
      willMember, financialMember, healthCareMember, livingWillMember,
    ]],
  ] as const)('auto-populates the %s charges', (_label, assemble, planType, totalCents, expectedRows) => {
    const result = assemble()
    expect(result.preflight).toEqual([])
    expect(result.data?.planType).toBe(planType)
    expect(result.data?.grandTotalCents).toBe(totalCents)
    expect(result.data?.sections[0].title).toBe('Estate Planning Claim')
    expect(result.data?.sections[0].items.map(item => [item.document, item.serviceCode, item.feeCents])).toEqual(expectedRows)
    expect(result.data?.sections[0].items.map(item => item.comment)).toEqual(
      expectedRows.map(([document, serviceCode]) => `CT ${serviceCode} — ${document}`),
    )
    expect(result.data?.grandTotalCents).toBe(96_500)
  })

  it('bills separate-trust pour-over wills at the member rate, not the couple rate', () => {
    const result = claim({ trust: { separate_trusts: true } as DraftPayload['trust'] })
    expect(result.data?.planType).toBe('separate_trust')
    expect(result.data?.grandTotalCents).toBe(139_500)
    const wills = result.data!.sections.flatMap(section => section.items).filter(item => item.serviceType === 'Will')
    expect(wills).toHaveLength(2)
    expect(wills.every(item => item.feeCents === METLIFE_FEES.will.member)).toBe(true)
  })

  it('bills the remaining three compositions', () => {
    expect(claim({}, { include_trust: false, include_pour_over_will: false, include_simple_will: true }).data?.grandTotalCents)
      .toBe(SHARED_COUPLE + METLIFE_FEES.will.couple)
    expect(claim({ spouse: null }, { include_trust: false, include_pour_over_will: false, include_simple_will: true }).data?.grandTotalCents)
      .toBe(SHARED_MEMBER + METLIFE_FEES.will.member)
    expect(claim({ spouse: null }).data?.grandTotalCents)
      .toBe(SHARED_MEMBER + METLIFE_FEES.will.member + METLIFE_FEES.trust.member + METLIFE_FEES.affidavit.member)

  })

  it('adds one realty trust section per property', () => {
    const one = claim({}, { include_real_estate_trust: true })
    const three = claim({}, { include_real_estate_trust: true }, { realtyTrustCount: 3 })
    const realtyCost = METLIFE_FEES.deed.member + METLIFE_FEES.trust.couple + METLIFE_FEES.affidavit.member
    expect(realtyCost).toBe(55_500)
    expect(one.data!.grandTotalCents - claim().data!.grandTotalCents).toBe(realtyCost)
    expect(three.data!.grandTotalCents - claim().data!.grandTotalCents).toBe(realtyCost * 3)
    expect(three.data!.sections.filter(section => section.title.startsWith('Realty Trust and Deed'))).toHaveLength(3)
  })

  it('does not add HIPAA or trust-affidavit charges to a core package', () => {
    // The design sheet includes HIPAA and a trust certificate by default; the
    // approved package matrix intentionally does not turn either into a core row.
    const result = claim()
    const coreDocuments = result.data!.sections[0].items.map(item => item.document)
    expect(coreDocuments).toHaveLength(6)
    expect(coreDocuments.some(document => document.includes('HIPAA'))).toBe(false)
    expect(coreDocuments.some(document => document.includes('Affidavit'))).toBe(false)
  })

  it('adds a temporary guardian affidavit when the matter appoints a guardian', () => {
    const result = claim({}, { include_parental_appointment: true })
    const guardian = result.data!.sections.flatMap(section => section.items)
      .find(item => item.document === 'Temporary Guardian Affidavit')
    expect(guardian?.feeCents).toBe(METLIFE_FEES.affidavit.member)
    expect(guardian?.serviceType).toBe('Affidavit')
    expect(guardian?.serviceCode).toBe('700')
    expect(guardian?.comment).toContain('CT 700')
  })

  it('sums every section total from its own line items', () => {
    const result = claim({ trust: { separate_trusts: true } as DraftPayload['trust'] })
    for (const section of result.data!.sections) {
      expect(section.totalCents).toBe(section.items.reduce((sum, item) => sum + item.feeCents, 0))
    }
    expect(result.data!.grandTotalCents).toBe(result.data!.sections.reduce((sum, section) => sum + section.totalCents, 0))
  })
})

describe('MetLife preflight', () => {
  it('blocks a matter that is not billed to MetLife', () => {
    const result = claim({}, {}, {}, { ...DETAILS, billingType: 'flat_fee' })
    expect(result.data).toBeNull()
    expect(result.preflight.map(issue => issue.field)).toContain('billingType')
  })

  it('blocks a missing member ID and service window, marking them [UNKNOWN]', () => {
    const result = claim({}, {}, {}, { billingType: 'metlife' })
    expect(result.data).toBeNull()
    expect(result.preflight.map(issue => issue.field)).toEqual(expect.arrayContaining(['memberId', 'serviceStart', 'serviceEnd']))
    expect(result.preflight.every(issue => issue.message.includes('[UNKNOWN]'))).toBe(true)
  })

  it('blocks a plan type that contradicts the matter', () => {
    expect(claim({}, {}, { planType: 'individual_trust' }).preflight.some(issue => issue.message.includes('conflicts'))).toBe(true)
    expect(claim({ spouse: null }, {}, { planType: 'joint_trust' }).preflight.some(issue => issue.message.includes('conflicts'))).toBe(true)
  })

  it('blocks a service window that ends before it starts', () => {
    const result = claim({}, {}, {}, { ...DETAILS, serviceStart: '2026-04-15', serviceEnd: '2026-04-01' })
    expect(result.data).toBeNull()
    expect(result.preflight.map(issue => issue.field)).toContain('serviceEnd')
  })

  it('falls back to the matter work dates when the plan service window is blank', () => {
    const result = claim({}, {}, {}, { billingType: 'metlife', memberId: 'MET-1', workStarted: '2026-03-02', workFinished: '2026-03-20' })
    expect(result.data?.serviceStart).toBe('2026-03-02')
    expect(result.data?.serviceEnd).toBe('2026-03-20')
  })

  it('takes an explicit attorney override over the stored matter value', () => {
    const result = claim({}, {}, { memberId: 'OVERRIDE-9', planType: 'separate_trust' })
    expect(result.data?.memberId).toBe('OVERRIDE-9')
    expect(result.data?.planType).toBe('separate_trust')
  })
})

describe('Portal submission table', () => {
  it('numbers every line item sequentially across sections', () => {
    const data = claim({ trust: { separate_trusts: true } as DraftPayload['trust'] }, { include_real_estate_trust: true }).data!
    const rows = buildSubmissionRows(data)
    expect(rows).toHaveLength(data.sections.reduce((sum, section) => sum + section.items.length, 0))
    expect(rows.map(row => row.index)).toEqual(rows.map((_, index) => index + 1))
    expect(rows.every(row => row.complete === 'Yes')).toBe(true)
    expect(rows[0].fee).toBe('$85.00')
    expect(rows[0].serviceCode).toBe('220')

  })

  it('renders a CSV with a header row and quoted fields', () => {
    const csv = submissionCsv(buildSubmissionRows(claim().data!))
    const lines = csv.split('\n')
    expect(lines[0]).toBe('"#","Document","Service Type","Fee","Comment","Complete"')
    expect(lines).toHaveLength(buildSubmissionRows(claim().data!).length + 1)
  })
})

describe('MetLife Massachusetts fee schedule', () => {
  it('uses the attached fixed fees and CT codes', () => {
    expect(METLIFE_FEES.advancedMedicalDirective).toEqual({ member: 4_500, couple: 6_000 })
    expect(METLIFE_SCHEDULE_ITEMS.find(item => item.key === 'deed')).toMatchObject({ code: '420', amountCents: 9_000 })
    expect(METLIFE_SCHEDULE_ITEMS.find(item => item.key === 'affidavit_prepared')).toMatchObject({ code: '700', amountCents: 6_500 })
  })

  it('calculates CT 250 probate fees with the minimum, breakpoint, and cap', () => {
    expect(metlifeProbateFeeCents(1_000_000)).toBe(45_000)
    expect(metlifeProbateFeeCents(10_000_000)).toBe(150_000)
    expect(metlifeProbateFeeCents(20_000_000)).toBe(250_000)
    expect(metlifeProbateFeeCents(100_000_000)).toBe(400_000)
    expect(metlifeProbateFeeCents(-1)).toBeNull()
  })

  it('calculates CT 270 inheritance litigation fees through the case cap', () => {
    expect(metlifeInheritanceLitigationFeeCents(10)).toBe(100_000)
    expect(metlifeInheritanceLitigationFeeCents(12.5)).toBe(125_000)
    expect(metlifeInheritanceLitigationFeeCents(25)).toBe(200_000)
    const item = METLIFE_SCHEDULE_ITEMS.find(candidate => candidate.key === 'inheritance_litigation')!
    expect(calculateMetlifeScheduleAmount(item, 12.5)).toBe(125_000)
  })
})

describe('MetLife document generation', () => {
  it('names the file after the clients and the submission date', () => {
    expect(metlifeClaimFilename(claim().data!)).toBe('Chen_MetLife_Claim_2026-04-20.docx')
  })

  it('generates a non-empty Word document', async () => {
    const artifact = await generateMetlifeArtifact(claim({ trust: { separate_trusts: true } as DraftPayload['trust'] }).data!)
    expect(artifact.kind).toBe('metlife_claim')
    expect(artifact.bytes.subarray(0, 2).toString()).toBe('PK')
    expect(artifact.bytes.byteLength).toBeGreaterThan(5_000)
  })
})

describe('MetLife ledger', () => {
  async function withStubbedDb(existing: unknown) {
    const inserted: Record<string, unknown>[] = []
    const updated: Record<string, unknown>[] = []
    const db = {
      from(table: string) {
        if (table === 'billing_events') {
          return { insert: (row: Record<string, unknown>) => { inserted.push({ table, ...row }); return Promise.resolve({ error: null }) } }
        }
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: existing, error: null }) }) }),
                }),
              }),
            }),
          }),
          insert: (row: Record<string, unknown>) => {
            inserted.push({ table, ...row })
            return { select: () => ({ single: () => Promise.resolve({ data: { id: 'item-new' }, error: null }) }) }
          },
          update: (row: Record<string, unknown>) => {
            updated.push({ table, ...row })
            return { eq: () => Promise.resolve({ error: null }) }
          },
        }
      },
    }
    vi.doMock('@/lib/works/data', () => ({ worksDb: () => db }))
    const { ensureMetlifeClaimItem } = await import('@/lib/metlife/ledger')
    return { ensureMetlifeClaimItem, inserted, updated }
  }

  it('creates the plan claim when the matter has none', async () => {
    vi.resetModules()
    const { ensureMetlifeClaimItem, inserted } = await withStubbedDb(null)
    const result = await ensureMetlifeClaimItem({ matterId: 'matter-1', amountCents: 140_000, userId: 'user-1' })
    expect(result).toMatchObject({ itemId: 'item-new', created: true, amountCents: 140_000 })
    expect(inserted[0]).toMatchObject({ table: 'billing_items', kind: 'plan_claim', plan: 'metlife', amount_billed: 140_000, source: 'workflow' })
    expect(inserted[1]).toMatchObject({ table: 'billing_events', event_type: 'item_seeded' })
    vi.doUnmock('@/lib/works/data')
  })

  it('updates an existing claim instead of adding a second one', async () => {
    vi.resetModules()
    const { ensureMetlifeClaimItem, inserted, updated } = await withStubbedDb({ id: 'item-1', status: 'to_invoice', amount_billed: 97_000 })
    const result = await ensureMetlifeClaimItem({ matterId: 'matter-1', amountCents: 140_000, userId: 'user-1' })
    expect(result).toMatchObject({ itemId: 'item-1', created: false })
    expect(inserted).toHaveLength(0)
    expect(updated[0]).toMatchObject({ amount_billed: 140_000 })
    vi.doUnmock('@/lib/works/data')
  })

  it('leaves a paid claim alone', async () => {
    vi.resetModules()
    const { ensureMetlifeClaimItem, updated } = await withStubbedDb({ id: 'item-1', status: 'paid', amount_billed: 97_000 })
    await ensureMetlifeClaimItem({ matterId: 'matter-1', amountCents: 140_000, userId: 'user-1' })
    expect(updated).toHaveLength(0)
    vi.doUnmock('@/lib/works/data')
  })

  it('refuses a non-positive total', async () => {
    vi.resetModules()
    const { ensureMetlifeClaimItem } = await withStubbedDb(null)
    await expect(ensureMetlifeClaimItem({ matterId: 'matter-1', amountCents: 0, userId: 'user-1' })).rejects.toThrow(/positive total/)
    vi.doUnmock('@/lib/works/data')
  })
})
