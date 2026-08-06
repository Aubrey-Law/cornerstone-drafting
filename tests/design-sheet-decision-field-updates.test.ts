import { describe, expect, it } from 'vitest'
import {
  buildDesignSheetPersistencePayload,
  buildDesignSheetSavePayload,
  inflateDesignSheetRow,
} from '@/lib/designSheetPersistence'
import { prepareDesignSheetForSave } from '@/lib/designSheet/designSheetDraft'
import { buildIntakeResyncPatch } from '@/lib/designSheet/seedFromIntake'
import {
  normalizeResidualBeneficiaryMethod,
  resolveResidualBeneficiaryMethod,
  setTrustDetails,
} from '@/lib/designSheetTrustDetails'
import type { DesignSheet } from '@/types/database'

/**
 * Mirrors the client PATCH body from useDesignSheetState.persistSheet and the
 * server merge from the design-sheet route, so a load → edit → save → reload
 * cycle is checked end to end.
 */
function saveAndReload(row: Record<string, unknown>, edit: (sheet: DesignSheet) => DesignSheet) {
  const loaded = inflateDesignSheetRow(row)
  if (!loaded) throw new Error('row did not inflate')

  const edited = edit(loaded)
  const sheetForSave = prepareDesignSheetForSave(edited)
  const decisions = {
    ...((edited.decisions ?? {}) as Record<string, unknown>),
    ...((sheetForSave.decisions as Record<string, unknown> | undefined) ?? {}),
  }

  const payload = buildDesignSheetSavePayload({
    existingSheet: inflateDesignSheetRow(row),
    incomingSheet: sheetForSave as unknown as Record<string, unknown>,
    incomingDecisions: decisions,
  })

  return inflateDesignSheetRow({ ...row, ...payload })
}

describe('design sheet decisions-backed field updates', () => {
  it('saves the first edit to a field with no dedicated column', () => {
    const reloaded = saveAndReload(
      { id: 'sheet-1', matter_id: 'matter-1', decisions: {} },
      sheet => ({ ...sheet, bond: 'no_bond' }) as DesignSheet,
    )

    expect(reloaded?.bond).toBe('no_bond')
  })

  // Regression: a `!(key in decisions)` guard in buildDesignSheetPersistencePayload
  // froze these fields at whatever value was stored first. Attorneys saw the edit
  // stick until the page reloaded, then revert.
  it('saves a second edit once the field is already stored in decisions', () => {
    const reloaded = saveAndReload(
      { id: 'sheet-1', matter_id: 'matter-1', decisions: { bond: 'no_bond' } },
      sheet => ({ ...sheet, bond: 'required' }) as DesignSheet,
    )

    expect(reloaded?.bond).toBe('required')
  })

  it('saves repeated edits across the Will, DPOA and health care fields', () => {
    const row = {
      id: 'sheet-1',
      matter_id: 'matter-1',
      decisions: {
        supervision: 'supervised',
        no_contest_clause: 'include',
        dpoa_include_section_l: 'yes',
        hcp_anatomical_gift: 'none',
        hipaa_psychotherapy_notes: 'do_not_authorize',
      },
    }

    const reloaded = saveAndReload(row, sheet => ({
      ...sheet,
      supervision: 'unsupervised',
      no_contest_clause: 'omit',
      dpoa_include_section_l: 'no',
      hcp_anatomical_gift: 'all',
      hipaa_psychotherapy_notes: 'authorize',
    }) as DesignSheet)

    expect(reloaded).toMatchObject({
      supervision: 'unsupervised',
      no_contest_clause: 'omit',
      dpoa_include_section_l: 'no',
      hcp_anatomical_gift: 'all',
      hipaa_psychotherapy_notes: 'authorize',
    })
  })

  it('keeps nested decision namespaces authoritative over stale top-level mirrors', () => {
    const row = {
      id: 'sheet-1',
      matter_id: 'matter-1',
      decisions: {
        document_inclusions: { trust: false },
        trust_details: { co_trustee_decision: 'jointly' },
      },
    }

    const reloaded = saveAndReload(row, sheet => ({
      ...sheet,
      // A legacy stale mirror on the sheet top-level must not win…
      document_inclusions: { trust: false },
      // …over the namespace the UI actually updated.
      decisions: {
        ...(sheet.decisions as Record<string, unknown>),
        document_inclusions: { trust: true },
      },
    }) as unknown as DesignSheet)

    const decisions = reloaded?.decisions as Record<string, Record<string, unknown>>
    expect(decisions.document_inclusions.trust).toBe(true)
    expect(decisions.trust_details.co_trustee_decision).toBe('jointly')
  })

  it('does not resurrect a stale value when the client sends no decisions blob', () => {
    const row = { id: 'sheet-1', matter_id: 'matter-1', decisions: { bond: 'no_bond' } }
    const existingSheet = inflateDesignSheetRow(row)

    const payload = buildDesignSheetSavePayload({
      existingSheet,
      incomingSheet: { drafting_notes: 'later' },
      incomingDecisions: {},
    })

    expect((payload.decisions as Record<string, unknown>).bond).toBe('no_bond')
    expect(payload.drafting_notes).toBe('later')
  })
})

// Regression: these callers patch columns only, but the builder always emitted a
// `decisions` key. Spreading that into an UPDATE overwrote the stored blob with
// `{}` — an asset sync or intake re-sync silently erased every design decision.
describe('column-only patches leave the decisions column alone', () => {
  it('omits decisions when the caller patches assets only', () => {
    const payload = buildDesignSheetPersistencePayload({
      assets: [{ id: 'a1', description: 'House' }],
    } as never)

    expect('decisions' in payload).toBe(false)
  })

  it('omits decisions when the caller patches intake columns only', () => {
    const payload = buildDesignSheetPersistencePayload({
      client_name: 'Jane Doe',
      overrides: null,
    } as never)

    expect('decisions' in payload).toBe(false)
    expect(payload.client_name).toBe('Jane Doe')
  })

  it('still writes decisions when the caller supplies them', () => {
    const payload = buildDesignSheetPersistencePayload({
      client_name: 'Jane Doe',
      decisions: {},
    } as never)

    expect(payload.decisions).toEqual({})
  })

  it('still writes decisions when a non-column field needs one', () => {
    const payload = buildDesignSheetPersistencePayload({ bond: 'required' } as never)

    expect(payload.decisions).toEqual({ bond: 'required' })
  })
})

describe('intake re-sync preserves stored decisions', () => {
  it('keeps existing decisions while folding in the re-synced fields', () => {
    const storedDecisions = {
      document_inclusions: { trust: true },
      bond: 'required',
    }
    const patch = buildIntakeResyncPatch({
      currentSheet: { overrides: null },
      intake: { first_name: 'Jane', last_name: 'Doe', spouse_aka: 'Janie' } as never,
      fields: ['client_name', 'spouse_aka'] as never,
    })

    const payload = buildDesignSheetPersistencePayload({
      decisions: storedDecisions,
      ...patch,
    } as never)

    const decisions = payload.decisions as Record<string, unknown>
    expect(decisions.document_inclusions).toEqual({ trust: true })
    expect(decisions.bond).toBe('required')
    expect(payload.client_name).toBe('Jane Doe')
  })
})

// The design-sheet import map is flat, so it can only propose `distribution_method`.
// Left on the column, an existing trust_details value would shadow it and accepting
// the import would silently do nothing — so the apply path routes it to the
// canonical home. Mirrors handleImportedDesignSheetFields in useDesignSheetState.
describe('imported distribution method lands in trust_details', () => {
  function applyImport(prev: Record<string, unknown>, patch: Record<string, unknown>) {
    const { distribution_method: importedMethod, ...rest } = patch
    const next = { ...prev, ...rest } as unknown as DesignSheet
    const method = normalizeResidualBeneficiaryMethod(importedMethod)
    if (!method) return next
    return { ...next, decisions: setTrustDetails(next, { residual_beneficiary_method: method }) }
  }

  it('overrides a trust_details value that would otherwise shadow the import', () => {
    const next = applyImport(
      { decisions: { trust_details: { residual_beneficiary_method: 'outright' } } },
      { distribution_method: 'staggered' },
    )

    expect(resolveResidualBeneficiaryMethod(next as never)).toBe('staggered')
  })

  it('leaves the column unwritten', () => {
    const next = applyImport({ decisions: {} }, { distribution_method: 'custom' }) as Record<string, unknown>

    expect(next.distribution_method).toBeUndefined()
    expect(resolveResidualBeneficiaryMethod(next as never)).toBe('custom')
  })

  it('keeps other imported fields and ignores an unusable method', () => {
    const next = applyImport({ decisions: {} }, {
      distribution_method: 'per stirpes',
      trust_name: 'The Doe Trust',
    }) as Record<string, unknown>

    expect(next.trust_name).toBe('The Doe Trust')
    expect(resolveResidualBeneficiaryMethod(next as never)).toBeNull()
  })
})
