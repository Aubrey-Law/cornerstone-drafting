import { describe, expect, it } from 'vitest'
import { isPlaceholderName, realNameOrNull } from '@/lib/draftPayload/placeholderNames'
import { buildFiduciaryRoleDetailsFromDesignSheet } from '@/lib/draftPayload/fiduciaryDetails'
import { buildFiduciariesFromDesignSheet } from '@/lib/draftPayload/helpers'
import type { ContactRow, DesignSheetRow } from '@/lib/draftPayload/types'

describe('isPlaceholderName', () => {
  it('recognises the stand-ins an attorney actually types', () => {
    for (const name of ['To Be Determined', 'TBD', 'tba', 'Unknown', 'N/A', 'Pending', '???']) {
      expect(isPlaceholderName(name), name).toBe(true)
    }
  })

  it('tolerates the punctuation and spacing people type', () => {
    for (const name of ['T.B.D.', 'tbd.', 'To  Be  Determined', '  TBD  ']) {
      expect(isPlaceholderName(name), name).toBe(true)
    }
  })

  it('never matches on a substring, because dropping a real appointee is invisible', () => {
    // The failure this guards against is silent: a genuine fiduciary vanishing
    // from an instrument is far worse than a placeholder surviving into one.
    for (const name of [
      'Tara Bandt',
      'Anna Tba',
      'Nadia Unknown-Smith',
      'Tabitha Bell-Dunn',
      'Sarah Pendington',
      'Noone Baker',
      'Nathan Aldridge',
    ]) {
      expect(isPlaceholderName(name), name).toBe(false)
    }
  })

  it('treats absent and empty as not-a-placeholder, leaving them to the empty check', () => {
    expect(isPlaceholderName(null)).toBe(false)
    expect(isPlaceholderName(undefined)).toBe(false)
    expect(isPlaceholderName('   ')).toBe(false)
  })

  it('realNameOrNull passes a real name through untouched but trimmed', () => {
    expect(realNameOrNull('  Marisa Kenney ')).toBe('Marisa Kenney')
    expect(realNameOrNull('To Be Determined')).toBeNull()
    expect(realNameOrNull('')).toBeNull()
  })
})

const CLIENT = {
  full_name: 'Casey Client',
  address: '10 State Street',
  phone: null,
  email: null,
  date_of_birth: null,
}

function contact(id: string, first: string, last: string): ContactRow {
  return {
    id,
    first_name: first,
    last_name: last,
    phone: '617-555-0100',
    email: null,
    address_line1: '1 Main Street',
    date_of_birth: null,
    relationship_type: 'Friend',
    relationship_label: 'Friend',
  } as unknown as ContactRow
}

function slot(contactId: string, order = 0) {
  return { id: `slot-${contactId}-${order}`, contact_id: contactId, order, is_co: false }
}

describe('a fiduciary slot holding a placeholder contact', () => {
  const placeholder = contact('c-tbd', 'To Be', 'Determined')
  const real = contact('c-real', 'Marisa', 'Kenney')

  it('reads as unfilled rather than appointing a nameless fiduciary', () => {
    // Before this, the generator had a name, emitted no marker, the preflight
    // reported the document clean, and the share gate passed it — so a will
    // could reach a client naming "To Be Determined" as guardian.
    const sheet = {
      guardian_slots: [slot('c-tbd')],
      hcp_slots: [slot('c-tbd')],
    } as unknown as DesignSheetRow

    const details = buildFiduciaryRoleDetailsFromDesignSheet(sheet, [placeholder], CLIENT, null)

    expect(details.guardians.primary).toBeNull()
    expect(details.healthcare_agent.primary).toBeNull()
  })

  it('leaves the fiduciary name blank so the generator emits its marker', () => {
    const sheet = { hcp_slots: [slot('c-tbd')] } as unknown as DesignSheetRow

    const fiduciaries = buildFiduciariesFromDesignSheet(
      sheet,
      [placeholder],
      { full_name: 'Casey Client', address: '10 State Street' },
      null,
    )

    expect(fiduciaries.hcp_primary).toBeFalsy()
  })

  it('does not disturb a real appointee in the next slot along', () => {
    const sheet = {
      hcp_slots: [slot('c-tbd', 0), slot('c-real', 1)],
    } as unknown as DesignSheetRow

    const details = buildFiduciaryRoleDetailsFromDesignSheet(
      sheet,
      [placeholder, real],
      CLIENT,
      null,
    )

    expect(details.healthcare_agent.primary).toBeNull()
    expect(details.healthcare_agent.alternate?.full_name).toBe('Marisa Kenney')
  })

  it('still appoints a real contact, unchanged', () => {
    const sheet = { trustee_slots: [slot('c-real')] } as unknown as DesignSheetRow

    const details = buildFiduciaryRoleDetailsFromDesignSheet(sheet, [real], CLIENT, null)

    expect(details.trustee.primary?.full_name).toBe('Marisa Kenney')
    expect(details.trustee.primary?.phone).toBe('(617) 555-0100')
  })
})
