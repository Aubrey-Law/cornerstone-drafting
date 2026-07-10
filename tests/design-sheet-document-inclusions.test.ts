import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildDesignSheetPersistencePayload,
  inflateDesignSheetRow,
} from '@/lib/designSheetPersistence'
import {
  defaultDocumentInclusions,
  getDocumentInclusions,
  getEstatePlanDesignSetup,
  getTrustPlanningType,
  mergeDecisionUpdates,
  setDocumentInclusion,
  setEstatePlanDesignSetup,
  setTrustPlanningType,
} from '@/lib/designSheetDocumentInclusions'

describe('design sheet document inclusions', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-08T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('defaults the young adult estate plan on for children age 17.5 through 25', () => {
    const eligible = { name: 'Alex Example', dob: '2008-12-07', relationship: 'biological' as const, is_minor: true }
    const tooYoung = { name: 'Blake Example', dob: '2009-01-01', relationship: 'biological' as const, is_minor: true }
    const tooOld = { name: 'Casey Example', dob: '2000-06-07', relationship: 'biological' as const, is_minor: false }

    expect(defaultDocumentInclusions({
      plan_type: 'pour_over',
      marital_status: 'single',
      children: [eligible],
    }).young_adult_estate_plan).toBe(true)

    expect(defaultDocumentInclusions({
      plan_type: 'pour_over',
      marital_status: 'single',
      children: [tooYoung, tooOld],
    }).young_adult_estate_plan).toBe(false)

    expect(getDocumentInclusions({
      plan_type: 'pour_over',
      marital_status: 'single',
      children: [eligible],
      decisions: {
        document_inclusions: {
          young_adult_estate_plan: false,
        },
      },
    }).young_adult_estate_plan).toBe(false)
  })

  it('defaults trust inclusion only for revocable living trust plans', () => {
    expect(defaultDocumentInclusions({
      plan_type: 'pour_over',
      marital_status: 'single',
    }).trust).toBe(true)

    expect(defaultDocumentInclusions({
      plan_type: 'testamentary_trust',
      marital_status: 'single',
    }).trust).toBe(false)

    expect(defaultDocumentInclusions({
      plan_type: 'outright_will',
      marital_status: 'single',
    }).trust).toBe(false)
  })

  it('merges sequential core document inclusion updates without clobbering prior patches', () => {
    const sheet = {
      decisions: {
        document_inclusions: {
          trust: true,
          will: true,
          dpoa: true,
          healthcare: true,
        },
        estate_plan_design: {
          will: true,
          power_of_attorney: true,
        },
      },
    }

    const uncheckedWill = mergeDecisionUpdates(sheet,
      current => setDocumentInclusion(current, 'will', false),
      current => setEstatePlanDesignSetup(current, { will: false }),
    )

    expect(getDocumentInclusions({ decisions: uncheckedWill }).will).toBe(false)
    expect(getEstatePlanDesignSetup({ decisions: uncheckedWill }).will).toBe(false)
    expect(getDocumentInclusions({ decisions: uncheckedWill }).dpoa).toBe(true)

    const uncheckedDpoa = mergeDecisionUpdates(
      { decisions: uncheckedWill },
      current => setDocumentInclusion(current, 'dpoa', false),
      current => setEstatePlanDesignSetup(current, { power_of_attorney: false }),
    )

    expect(getDocumentInclusions({ decisions: uncheckedDpoa }).dpoa).toBe(false)
    expect(getEstatePlanDesignSetup({ decisions: uncheckedDpoa }).power_of_attorney).toBe(false)
  })

  it('defaults the trust planning type to outright_to_spouse and toggles it via the decisions JSONB', () => {
    expect(getTrustPlanningType({ decisions: null })).toBe('outright_to_spouse')
    expect(getTrustPlanningType({ decisions: {} })).toBe('outright_to_spouse')
    expect(getTrustPlanningType({ decisions: { trust_planning_type: 'disclaimer' } })).toBe('disclaimer')
    expect(getTrustPlanningType({ decisions: { trust_planning_type: 'standard' } })).toBe('outright_to_spouse')

    const updated = setTrustPlanningType({ decisions: { document_inclusions: { trust: true } } }, 'disclaimer')
    expect(updated).toEqual({
      document_inclusions: { trust: true },
      trust_planning_type: 'disclaimer',
    })
    expect(getTrustPlanningType({ decisions: setTrustPlanningType({ decisions: updated }, 'outright_to_spouse') })).toBe('outright_to_spouse')
  })

  it('round-trips trust document inclusion through save payload and inflate', () => {
    const decisions = mergeDecisionUpdates(
      { decisions: { document_inclusions: { trust: false, will: true, dpoa: true, healthcare: true } } },
      current => setDocumentInclusion(current, 'trust', true),
      current => setEstatePlanDesignSetup(current, { trust: true, will_title: 'pour_over_will' }),
    )

    const payload = buildDesignSheetPersistencePayload({
      plan_type: 'outright_will',
      decisions,
    } as Parameters<typeof buildDesignSheetPersistencePayload>[0])

    const inflated = inflateDesignSheetRow({
      ...payload,
      decisions: payload.decisions,
    })

    expect(getDocumentInclusions({
      plan_type: inflated?.plan_type ?? null,
      marital_status: null,
      decisions: inflated?.decisions ?? {},
    }).trust).toBe(true)
    expect(getEstatePlanDesignSetup({
      plan_type: inflated?.plan_type ?? null,
      marital_status: null,
      decisions: inflated?.decisions ?? {},
    }).trust).toBe(true)
  })

  it('does not let stale inflated top-level document_inclusions overwrite decisions on save', () => {
    const loaded = inflateDesignSheetRow({
      id: 'sheet-1',
      plan_type: 'outright_will',
      decisions: {
        document_inclusions: { trust: false, will: true, dpoa: true, healthcare: true },
        estate_plan_design: { trust: false, will: true },
      },
    })

    // Decision-only keys must stay inside decisions — not mirrored onto the sheet.
    expect((loaded as Record<string, unknown> | null)?.document_inclusions).toBeUndefined()

    const decisions = mergeDecisionUpdates(
      { decisions: loaded?.decisions ?? {} },
      current => setDocumentInclusion(current, 'trust', true),
      current => setEstatePlanDesignSetup(current, { trust: true, will_title: 'pour_over_will' }),
    )
    // Simulate a legacy client that still carried a stale top-level mirror.
    const localSheet = {
      ...loaded!,
      decisions,
      document_inclusions: { trust: false, will: true, dpoa: true, healthcare: true },
    }

    const payload = buildDesignSheetPersistencePayload(
      localSheet as Parameters<typeof buildDesignSheetPersistencePayload>[0],
    )

    expect((payload.decisions as Record<string, unknown>).document_inclusions).toMatchObject({
      trust: true,
    })
    expect(getDocumentInclusions({
      plan_type: 'outright_will',
      marital_status: null,
      decisions: payload.decisions as Record<string, unknown>,
    }).trust).toBe(true)
  })

  it('keeps trust true through the API merge of inflated existing row + client body', () => {
    const existing = inflateDesignSheetRow({
      id: 'sheet-1',
      plan_type: 'outright_will',
      updated_at: '2026-07-10T20:00:00.000Z',
      decisions: {
        document_inclusions: { trust: false, will: true, dpoa: true, healthcare: true },
      },
    })

    const decisions = mergeDecisionUpdates(
      { decisions: existing?.decisions ?? {} },
      current => setDocumentInclusion(current, 'trust', true),
      current => setEstatePlanDesignSetup(current, { trust: true, will_title: 'pour_over_will' }),
    )
    const bodySheet = { ...existing!, decisions }

    const sheetForPersistence = { ...existing!, ...bodySheet }
    const payload = buildDesignSheetPersistencePayload(
      sheetForPersistence as Parameters<typeof buildDesignSheetPersistencePayload>[0],
    )

    expect(getDocumentInclusions({
      plan_type: 'outright_will',
      marital_status: null,
      decisions: payload.decisions as Record<string, unknown>,
    }).trust).toBe(true)
  })
})
