import { describe, expect, it } from 'vitest'
import {
  applyFiduciaryProposalsToSheet,
  fiduciarySlotField,
  resolveFiduciaryProposals,
  type FiduciaryProposal,
} from '@/lib/designSheet/fiduciaryProposal'
import { computeDesignSheetReadiness } from '@/lib/designSheetReadiness'
import type { DesignSheet, FiduciarySlot } from '@/types/database'

const CONTACTS = [
  { id: 'c-mary', first_name: 'Mary', last_name: 'Okafor' },
  { id: 'c-david', first_name: 'David', last_name: 'Okafor' },
]

function sheet(slots: Partial<Record<string, FiduciarySlot[]>> = {}): DesignSheet {
  return {
    trustee_slots: [], executor_slots: [], poa_slots: [], hcp_slots: [],
    guardian_slots: [], temporary_guardian_slots: [],
    spouse_trustee_slots: [], spouse_executor_slots: [],
    spouse_poa_slots: [], spouse_hcp_slots: [],
    ...slots,
  } as unknown as DesignSheet
}

function proposal(over: Partial<FiduciaryProposal> = {}): FiduciaryProposal {
  return {
    role: 'trustee', party: 'client', priority: 0, is_co: false,
    first_name: 'Mary', last_name: 'Okafor',
    ...over,
  }
}

describe('resolving proposed fiduciaries', () => {
  it('matches a name already on the matter and pre-selects it', () => {
    const [row] = resolveFiduciaryProposals({
      sheet: sheet(), contacts: CONTACTS, proposals: [proposal()],
    })

    expect(row.matchedContactId).toBe('c-mary')
    expect(row.label).toBe('Trustee — primary')
    expect(row.selected).toBe(true)
    expect(row.currentDisplay).toBe('-')
  })

  it('leaves a name that would mint a new contact unchecked', () => {
    // Creating a person is not something to do on a default-checked box.
    const [row] = resolveFiduciaryProposals({
      sheet: sheet(), contacts: CONTACTS,
      proposals: [proposal({ first_name: 'Priya', last_name: 'Raman' })],
    })

    expect(row.matchedContactId).toBeNull()
    expect(row.selected).toBe(false)
  })

  it('flags displacing whoever holds the slot now', () => {
    const [row] = resolveFiduciaryProposals({
      sheet: sheet({ trustee_slots: [{ id: 's1', contact_id: 'c-david', is_co: false, order: 0 }] }),
      contacts: CONTACTS,
      proposals: [proposal()],
    })

    expect(row.currentDisplay).toBe('David Okafor')
    expect(row.replacement).toBe(true)
    expect(row.selected).toBe(false)
  })

  it('drops a spouse guardian, which the sheet has no slot for', () => {
    // Guardianship is a household appointment; redirecting it onto the client's
    // guardian line would be a worse answer than proposing nothing.
    expect(fiduciarySlotField('guardian', 'spouse')).toBeNull()
    expect(resolveFiduciaryProposals({
      sheet: sheet(), contacts: CONTACTS,
      proposals: [proposal({ role: 'guardian', party: 'spouse' })],
    })).toEqual([])
  })

  it('keeps one row per slot when the model names two people for it', () => {
    const rows = resolveFiduciaryProposals({
      sheet: sheet(), contacts: CONTACTS,
      proposals: [proposal(), proposal({ first_name: 'David' })],
    })

    expect(rows).toHaveLength(1)
    expect(rows[0].matchedContactId).toBe('c-mary')
  })
})

describe('applying accepted fiduciaries', () => {
  it('writes the contact into the slot array readiness reads', () => {
    const current = sheet()
    const accepted = resolveFiduciaryProposals({
      sheet: current, contacts: CONTACTS, proposals: [proposal()],
    })

    const patch = applyFiduciaryProposalsToSheet({
      sheet: current, accepted, contactIdByProposalId: { [accepted[0].id]: 'c-mary' },
    })

    expect(patch.trustee_slots).toEqual([
      { id: 'trustee_slots-0-seq', contact_id: 'c-mary', is_co: false, order: 0 },
    ])
  })

  it('appends the alternate below the primary instead of overwriting it', () => {
    const current = sheet({
      trustee_slots: [{ id: 's1', contact_id: 'c-david', is_co: false, order: 0 }],
    })
    const accepted = resolveFiduciaryProposals({
      sheet: current, contacts: CONTACTS, proposals: [proposal({ priority: 1 })],
    })

    const patch = applyFiduciaryProposalsToSheet({
      sheet: current, accepted, contactIdByProposalId: { [accepted[0].id]: 'c-mary' },
    })

    expect(patch.trustee_slots).toEqual([
      { id: 's1', contact_id: 'c-david', is_co: false, order: 0 },
      { id: 'trustee_slots-1-seq', contact_id: 'c-mary', is_co: false, order: 1 },
    ])
  })

  it('touches only the roles that were accepted', () => {
    const current = sheet({
      hcp_slots: [{ id: 'h1', contact_id: 'c-david', is_co: false, order: 0 }],
    })
    const accepted = resolveFiduciaryProposals({
      sheet: current, contacts: CONTACTS, proposals: [proposal()],
    })

    const patch = applyFiduciaryProposalsToSheet({
      sheet: current, accepted, contactIdByProposalId: { [accepted[0].id]: 'c-mary' },
    })

    expect(Object.keys(patch)).toEqual(['trustee_slots'])
  })

  it('skips a row whose contact was never resolved', () => {
    const current = sheet()
    const accepted = resolveFiduciaryProposals({
      sheet: current, contacts: CONTACTS,
      proposals: [proposal({ first_name: 'Priya', last_name: 'Raman' })],
    })

    expect(applyFiduciaryProposalsToSheet({
      sheet: current, accepted, contactIdByProposalId: {},
    })).toEqual({})
  })
})

/**
 * The point of the whole exercise: the old import path set `trustee_primary`,
 * a legacy string column readiness never consults, so an import could appear to
 * fill the fiduciaries while every blocker stayed exactly where it was.
 */
describe('an accepted trustee actually clears the blocker', () => {
  const base = {
    ...sheet(),
    plan_type: 'revocable_trust',
    marital_status: 'single',
    children: [],
    decisions: {},
  } as unknown as DesignSheet

  const readinessArgs = {
    matter: { has_minor_children: false } as { has_minor_children: boolean },
    isLP: false,
    lpData: null,
  }

  function trusteeBlockers(target: DesignSheet) {
    return computeDesignSheetReadiness({ sheet: target, ...readinessArgs })
      .blocking.filter(item => item.targetField === 'trustee_slots')
  }

  function trusteeOptional(target: DesignSheet) {
    return computeDesignSheetReadiness({ sheet: target, ...readinessArgs })
      .optional.filter(item => item.targetField === 'trustee_slots')
  }

  it('blocks before, and does not block after', () => {
    expect(trusteeBlockers(base).length).toBeGreaterThan(0)

    const accepted = resolveFiduciaryProposals({
      sheet: base, contacts: CONTACTS, proposals: [proposal()],
    })
    const filled = {
      ...base,
      ...applyFiduciaryProposalsToSheet({
        sheet: base, accepted, contactIdByProposalId: { [accepted[0].id]: 'c-mary' },
      }),
    } as DesignSheet

    expect(trusteeBlockers(filled)).toEqual([])
    // The backup trustee is still wanted, but it never gated Generate.
    expect(trusteeOptional(filled).map(item => item.label)).toEqual(['backup trustee'])
  })
})
