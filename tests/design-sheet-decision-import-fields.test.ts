import { describe, expect, it } from 'vitest'
import {
  DESIGN_SHEET_DECISION_FIELDS,
  applyDecisionFieldValues,
  flattenDecisionNamespaces,
  readDecisionFieldRaw,
} from '@/lib/designSheetImport/decisionFields'
import {
  buildDesignSheetImportPreview,
  coerceDesignSheetImport,
  listDesignSheetImportFieldNames,
} from '@/lib/designSheetImport/shared'
import {
  buildDesignSheetSavePayload,
  inflateDesignSheetRow,
} from '@/lib/designSheetPersistence'
import { getTrustDetails } from '@/lib/designSheetTrustDetails'
import { getDesignSheetDpoaProvisions } from '@/lib/designSheetDpoaProvisions'
import type { DesignSheet } from '@/types/database'

function sheetWith(decisions: Record<string, unknown>): DesignSheet {
  return {
    decisions,
    hcp_anatomical_gift: null,
    dpoa_coagent_manner: null,
  } as unknown as DesignSheet
}

/**
 * Regression: `residual_beneficiary_method` used to ride along as a bare top-level
 * import field. Accepting it sent `{ residual_beneficiary_method }` to the PATCH
 * route, which has no such column, so the persistence layer parked it at
 * `decisions.residual_beneficiary_method` — while every reader
 * (`getTrustDetails`, readiness, the generator) only ever looks at
 * `decisions.trust_details.residual_beneficiary_method`. The value survived the
 * save and was never seen again; the sheet's own UI showed it applied until reload
 * because the client routed it correctly in local state only.
 */
describe('decision fields survive the save round trip', () => {
  it('lands trust details where getTrustDetails reads them', () => {
    const { proposed } = coerceDesignSheetImport({
      'trust_details.residual_beneficiary_method': 'Staggered',
    })
    const sheet = sheetWith({})

    const payload = buildDesignSheetSavePayload({
      existingSheet: sheet,
      incomingSheet: {},
      incomingDecisions: applyDecisionFieldValues(sheet, proposed as Record<string, unknown>),
    })
    const reloaded = inflateDesignSheetRow({
      id: 'sheet', matter_id: 'matter', decisions: payload.decisions,
    } as Record<string, unknown>)!

    expect(getTrustDetails(reloaded).residual_beneficiary_method).toBe('staggered')
    expect((reloaded.decisions as Record<string, unknown>).residual_beneficiary_method).toBeUndefined()
  })

  it('leaves decision namespaces it was not asked about alone', () => {
    const sheet = sheetWith({
      deed: { recorded: true },
      funding_plan: { step: 'first' },
      college_prep: { living_will_include: 'yes' },
    })

    const next = applyDecisionFieldValues(sheet, {
      'will_pr_powers.allow_manage_digital_assets': true,
    })

    expect(next.deed).toEqual({ recorded: true })
    expect(next.funding_plan).toEqual({ step: 'first' })
    expect(next.college_prep).toEqual({ living_will_include: 'yes' })
  })

  it('merges a single DPOA basic power onto the powers already stored', () => {
    // setDesignSheetDpoaProvisions replaces `basic_powers` wholesale and recomputes
    // all_basic_powers from it, so a patch carrying only the new power would switch
    // off every power the attorney had already checked.
    const sheet = sheetWith({
      dpoa_provisions: { basic_powers: { banking: true, tax_matters: true } },
    })

    const next = applyDecisionFieldValues(sheet, {
      'dpoa_provisions.basic_powers.real_property': true,
    })
    const powers = getDesignSheetDpoaProvisions(sheetWith(next)).basic_powers

    expect(powers.banking).toBe(true)
    expect(powers.tax_matters).toBe(true)
    expect(powers.real_property).toBe(true)
    expect(powers.stocks_bonds).toBe(false)
  })
})

describe('decision field naming', () => {
  it('keeps namespaces distinct where a bare key would collide', () => {
    // power_529_plans is a field of BOTH trust_details and dpoa_provisions.
    expect(DESIGN_SHEET_DECISION_FIELDS['trust_details.power_529_plans'].namespace).toBe('trust_details')
    expect(DESIGN_SHEET_DECISION_FIELDS['dpoa_provisions.power_529_plans'].namespace).toBe('dpoa_provisions')

    const next = applyDecisionFieldValues(sheetWith({}), {
      'dpoa_provisions.power_529_plans': true,
    })
    expect(readDecisionFieldRaw(sheetWith(next), 'dpoa_provisions.power_529_plans')).toBe(true)
    expect(readDecisionFieldRaw(sheetWith(next), 'trust_details.power_529_plans')).toBeUndefined()
  })

  it('accepts the nested shape a model emits when it ignores the flat-key rule', () => {
    expect(flattenDecisionNamespaces({
      trust_details: { co_trustee_decision: 'independent' },
      dpoa_provisions: { basic_powers: { banking: true } },
    })).toEqual({
      'trust_details.co_trustee_decision': 'independent',
      'dpoa_provisions.basic_powers.banking': true,
    })
  })

  it('offers every decision field to the extraction prompt', () => {
    const names = listDesignSheetImportFieldNames()
    for (const field of Object.keys(DESIGN_SHEET_DECISION_FIELDS)) {
      expect(names, field).toContain(field)
    }
  })
})

describe('preview of an undecided field', () => {
  it('reports blank rather than the getter default', () => {
    // getTrustDetails answers 'joint_majority' for co_trustee_decision on a blank
    // sheet. Reading through it here would show the attorney a replacement of a
    // value they never chose, and would defeat blank detection everywhere else.
    const [row] = buildDesignSheetImportPreview({
      currentSheet: sheetWith({}) as unknown as Record<string, unknown>,
      proposed: { 'trust_details.co_trustee_decision': 'independent' },
    })

    expect(row.currentValue).toBeUndefined()
    expect(row.currentDisplay).toBe('-')
    expect(row.replacement).toBe(false)
    expect(row.selected).toBe(true)
  })

  it('flags a real replacement when a value is already stored', () => {
    const [row] = buildDesignSheetImportPreview({
      currentSheet: sheetWith({
        trust_details: { co_trustee_decision: 'joint_majority' },
      }) as unknown as Record<string, unknown>,
      proposed: { 'trust_details.co_trustee_decision': 'independent' },
    })

    expect(row.replacement).toBe(true)
    expect(row.selected).toBe(false)
  })
})
