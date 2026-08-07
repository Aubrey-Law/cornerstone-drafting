import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CLIENT_SLOT_FIELDS,
  SHARED_SLOT_FIELDS,
  spouseSlotFields,
} from '@/app/admin/drafting/[matterId]/design/sections/fiduciary-blocks'
import { resolveIntakeReviewFlags, type IntakeReadinessFlag } from '@/lib/intakeReadiness'
import { computeDesignSheetReadiness } from '@/lib/designSheetReadiness'
import type { DesignSheet } from '@/types/database'

const slot = (contactId: string | null, order = 0, isCo = false) =>
  ({ id: `s-${order}-${isCo}`, contact_id: contactId, is_co: isCo, order })

// A joint trust is one instrument with one line of successor trustees; only
// separate trusts give each spouse their own. The spouse's will, POA and health
// care documents are always their own either way.
describe('successor trustee slots follow the trust structure', () => {
  it('shares one trustee set for a joint trust', () => {
    expect(spouseSlotFields({ is_joint: true }).trustee).toBe('trustee_slots')
    expect(spouseSlotFields({ is_joint: true }).trustee).toBe(CLIENT_SLOT_FIELDS.trustee)
  })

  it('gives each spouse their own trustee set for separate trusts', () => {
    expect(spouseSlotFields({ is_joint: false }).trustee).toBe('spouse_trustee_slots')
  })

  it('treats an unset structure as joint, matching the readiness gate', () => {
    expect(spouseSlotFields({ is_joint: null }).trustee).toBe('trustee_slots')
  })

  it('never shares the personal, POA or health care roles', () => {
    for (const joint of [true, false, null]) {
      const fields = spouseSlotFields({ is_joint: joint })
      expect(fields.executor).toBe('spouse_executor_slots')
      expect(fields.poa).toBe('spouse_poa_slots')
      expect(fields.hcp).toBe('spouse_hcp_slots')
    }
  })
})

describe('child-related roles are shared, not per party', () => {
  it('keeps guardians and temporary guardians out of the party maps', () => {
    expect('guardian' in CLIENT_SLOT_FIELDS).toBe(false)
    expect('guardian' in spouseSlotFields({ is_joint: true })).toBe(false)
    expect(SHARED_SLOT_FIELDS).toEqual({
      guardian: 'guardian_slots',
      temporary_guardian: 'temporary_guardian_slots',
    })
  })

  it('renders the shared roles outside the party tabs', () => {
    const grid = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/FiduciaryGrid.tsx'),
      'utf8',
    )
    // The shared matrix must not be inside the `married ? … : null` party block.
    expect(grid).toContain('slotFields={SHARED_SLOT_FIELDS}')
    expect(grid).toContain('For the children')
  })
})

describe('temporary guardian readiness', () => {
  const sheetWith = (overrides: Partial<DesignSheet>) => ({
    marital_status: 'married',
    children: [{ name: 'Kid', dob: '2018-01-01', relationship: 'biological', is_minor: true }],
    guardian_slots: [slot('c1')],
    decisions: { document_inclusions: { will: true, trust: false, dpoa: false, healthcare: false } },
    ...overrides,
  }) as unknown as DesignSheet

  const readiness = (sheet: DesignSheet) =>
    computeDesignSheetReadiness({ sheet, matter: {} as never, isLP: false, lpData: null })

  it('asks for a temporary guardian without blocking drafting', () => {
    const r = readiness(sheetWith({}))
    expect(r.optional.map(b => b.label)).toContain('temporary guardian')
    expect(r.blocking.map(b => b.label)).not.toContain('temporary guardian')
  })

  it('stops asking once one is named', () => {
    const r = readiness(sheetWith({ temporary_guardian_slots: [slot('c2')] } as Partial<DesignSheet>))
    expect(r.optional.map(b => b.label)).not.toContain('temporary guardian')
  })

  it('does not ask when there are no minor children', () => {
    const r = readiness(sheetWith({ children: [] }))
    expect([...r.optional, ...r.blocking].map(b => b.label)).not.toContain('temporary guardian')
  })
})

// Regression: intake_review_flags is a snapshot taken when the sheet is seeded, and
// nothing recomputed it — so naming a fiduciary in the design sheet (which writes
// `<role>_slots`, not the intake row) left the flag showing forever.
describe('review flags resolve against the design sheet', () => {
  const flag = (key: string): IntakeReadinessFlag => ({
    key, label: key, sectionId: 'fiduciaries', severity: 'review',
    resolutionKind: 'needs_data', message: key,
  })

  it('clears a fiduciary flag once the role is assigned', () => {
    const flags = [flag('client_trustee_missing'), flag('client_hcp_missing')]
    const sheet = { trustee_slots: [slot('c1')] }

    expect(resolveIntakeReviewFlags(flags, sheet).map(f => f.key)).toEqual(['client_hcp_missing'])
  })

  it('accepts "same as trustee" as an answer for the dependent roles', () => {
    const sheet = { trustee_slots: [slot('c1')], executor_same_as_trustee: true, poa_same_as_trustee: true }
    const flags = [flag('client_personal_rep_missing'), flag('client_poa_missing')]

    expect(resolveIntakeReviewFlags(flags, sheet)).toEqual([])
  })

  it('does not count a co-fiduciary as the principal choice', () => {
    const sheet = {
      children: [{ name: 'Kid', dob: '2018-01-01', relationship: 'biological', is_minor: true }],
      guardian_slots: [slot('c1', 0, true)],
    }

    expect(resolveIntakeReviewFlags([flag('guardian_missing')], sheet).map(f => f.key))
      .toEqual(['guardian_missing'])
  })

  // A guardian exists only for a minor child, so a family list with no minors on
  // it answers the intake question — naming one is not the only way out.
  it('clears the guardian flag when the sheet lists no minor children', () => {
    const sheet = {
      children: [
        { name: 'Alex Example', dob: '1994-01-01', relationship: 'biological', is_minor: false },
        { name: 'Blake Example', dob: '2004-01-01', relationship: 'biological', is_minor: false },
      ],
      guardian_slots: [],
    }

    expect(resolveIntakeReviewFlags([flag('guardian_missing')], sheet)).toEqual([])
  })

  it('keeps asking while the family list is still empty', () => {
    const sheet = { children: [], guardian_slots: [] }

    expect(resolveIntakeReviewFlags([flag('guardian_missing')], sheet).map(f => f.key))
      .toEqual(['guardian_missing'])
  })

  it('keeps asking when a minor child is listed and no guardian is named', () => {
    const sheet = {
      children: [{ name: 'Kid', dob: '2018-01-01', relationship: 'biological', is_minor: true }],
      guardian_slots: [],
    }

    expect(resolveIntakeReviewFlags([flag('guardian_missing')], sheet).map(f => f.key))
      .toEqual(['guardian_missing'])
  })

  // The spouse's own will/POA/health care documents exist only if there is a
  // spouse and the plan is preparing them for that spouse.
  describe('spouse flags', () => {
    const spouseFlags = [
      flag('spouse_personal_rep_missing'),
      flag('spouse_poa_missing'),
      flag('spouse_hcp_missing'),
    ]
    const keys = (sheet: Record<string, unknown>) =>
      resolveIntakeReviewFlags(spouseFlags, sheet).map(f => f.key)

    it('clears them once the sheet says the client is not married', () => {
      expect(keys({ marital_status: 'divorced' })).toEqual([])
      expect(keys({ marital_status: 'widowed' })).toEqual([])
      expect(keys({ marital_status: 'never married' })).toEqual([])
    })

    it('clears them when the plan is not preparing spouse documents', () => {
      const sheet = {
        marital_status: 'married',
        decisions: { document_inclusions: { spouse_docs: false } },
      }

      expect(keys(sheet)).toEqual([])
    })

    it('keeps asking while marital status is still blank', () => {
      expect(keys({})).toEqual(spouseFlags.map(f => f.key))
      expect(keys({ marital_status: '  ' })).toEqual(spouseFlags.map(f => f.key))
    })

    it('keeps asking for a married client whose spouse documents are in the plan', () => {
      expect(keys({ marital_status: 'married' })).toEqual(spouseFlags.map(f => f.key))
    })

    it('treats "remarried" as married so the ask stands', () => {
      expect(keys({ marital_status: 'remarried' })).toEqual(spouseFlags.map(f => f.key))
    })

    it('still clears individually once each role is assigned', () => {
      const sheet = {
        marital_status: 'married',
        spouse_executor_slots: [slot('c1')],
        spouse_poa_slots: [slot('c2')],
      }

      expect(keys(sheet)).toEqual(['spouse_hcp_missing'])
    })

    // The spouse's date of birth still feeds the *client's* documents — naming
    // the spouse as trustee, the marital share — so dropping the spouse's own
    // documents does not make it moot. Only "there is no spouse" does.
    it('drops the spouse DOB ask only when there is no spouse', () => {
      const dob = [flag('spouse_dob_missing')]
      const resolved = (sheet: Record<string, unknown>) =>
        resolveIntakeReviewFlags(dob, sheet).map(f => f.key)

      expect(resolved({ marital_status: 'divorced' })).toEqual([])
      expect(resolved({
        marital_status: 'married',
        decisions: { document_inclusions: { spouse_docs: false } },
      })).toEqual(['spouse_dob_missing'])
      expect(resolved({ marital_status: 'married', spouse_dob: '1972-03-04' })).toEqual([])
    })
  })

  it('clears non-fiduciary flags the sheet answers too', () => {
    const sheet = { client_dob: '1970-01-01', county: 'Suffolk' }

    expect(resolveIntakeReviewFlags([flag('client_dob_missing'), flag('county_missing')], sheet)).toEqual([])
  })

  it('leaves flags with no design-sheet equivalent alone', () => {
    const flags = [flag('real_estate_details_missing')]

    expect(resolveIntakeReviewFlags(flags, { client_dob: '1970-01-01' })).toEqual(flags)
  })

  it('returns the snapshot untouched when there is no sheet yet', () => {
    const flags = [flag('client_trustee_missing')]

    expect(resolveIntakeReviewFlags(flags, null)).toEqual(flags)
  })
})
