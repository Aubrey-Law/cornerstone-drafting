import { describe, expect, it } from 'vitest'
import {
  buildFiduciaryRoleDetailsFromDesignSheet,
  type FiduciaryPerson,
} from '@/lib/draftPayload/fiduciaryDetails'
import type { ContactRow, DesignSheetRow } from '@/lib/draftPayload/types'

const CLIENT_SLOT = '__design_sheet_client__'
const SPOUSE_SLOT = '__design_sheet_spouse__'

const CLIENT: FiduciaryPerson = {
  full_name: 'Casey Client',
  address: '10 State Street',
  phone: '6175550100',
  email: 'casey@example.com',
  date_of_birth: '1970-04-02',
}

const SPOUSE: FiduciaryPerson = {
  full_name: 'Sam Client',
  address: '10 State Street',
  phone: '(617) 555-0101',
  email: 'sam@example.com',
  date_of_birth: '1971-09-14',
}

/** A slot row needs an `id`; `isFiduciarySlotArray` rejects the array without one. */
function slot(contactId: string, order = 0) {
  return { id: `slot-${contactId}-${order}`, contact_id: contactId, order, is_co: false }
}

function sheetWithHcpSlot(contactId: string): DesignSheetRow {
  return { hcp_slots: [slot(contactId)] } as unknown as DesignSheetRow
}

function build(sheet: DesignSheetRow, contacts: ContactRow[] = []) {
  return buildFiduciaryRoleDetailsFromDesignSheet(sheet, contacts, CLIENT, SPOUSE)
}

describe('a fiduciary who is the client or the spouse', () => {
  it('carries the spouse’s phone rather than leaving the document with a hole', () => {
    // The regression this file exists for. `personDetail` returned phone: null
    // unconditionally, so every Health Care Proxy naming the spouse as agent
    // generated `[[ MISSING: healthcare.agent.primary.phone ]]` — and the design
    // sheet had no field to fill, because the spouse's number is not a contact's.
    const details = build(sheetWithHcpSlot(SPOUSE_SLOT))

    expect(details.healthcare_agent.primary?.full_name).toBe('Sam Client')
    expect(details.healthcare_agent.primary?.phone).toBe('(617) 555-0101')
  })

  it('carries the client’s phone, formatted the way a contact’s would be', () => {
    // Stored unformatted; a document must not read differently depending on
    // whether the agent happened to be the client or someone with a contact row.
    const details = build(sheetWithHcpSlot(CLIENT_SLOT))

    expect(details.healthcare_agent.primary?.phone).toBe('(617) 555-0100')
  })

  it('carries date of birth and email as well as the phone', () => {
    const details = build(sheetWithHcpSlot(SPOUSE_SLOT))

    expect(details.healthcare_agent.primary?.date_of_birth).toBe('1971-09-14')
    expect(details.healthcare_agent.primary?.email).toBe('sam@example.com')
    expect(details.healthcare_agent.primary?.address).toBe('10 State Street')
  })

  it('leaves a genuinely absent number null rather than inventing one', () => {
    const details = buildFiduciaryRoleDetailsFromDesignSheet(
      sheetWithHcpSlot(SPOUSE_SLOT),
      [],
      CLIENT,
      { ...SPOUSE, phone: null, date_of_birth: null },
    )

    expect(details.healthcare_agent.primary?.full_name).toBe('Sam Client')
    expect(details.healthcare_agent.primary?.phone).toBeNull()
    expect(details.healthcare_agent.primary?.date_of_birth).toBeNull()
  })

  it('still returns nothing for a slot pointing at a spouse who does not exist', () => {
    const details = buildFiduciaryRoleDetailsFromDesignSheet(
      sheetWithHcpSlot(SPOUSE_SLOT),
      [],
      CLIENT,
      null,
    )

    expect(details.healthcare_agent.primary).toBeNull()
  })

  it('applies to every role, not just the health care agent', () => {
    const sheet = {
      poa_slots: [slot(SPOUSE_SLOT)],
      trustee_slots: [slot(SPOUSE_SLOT)],
      executor_slots: [slot(CLIENT_SLOT)],
    } as unknown as DesignSheetRow

    const details = build(sheet)

    expect(details.agent.primary?.phone).toBe('(617) 555-0101')
    expect(details.trustee.primary?.phone).toBe('(617) 555-0101')
    expect(details.executor.primary?.phone).toBe('(617) 555-0100')
  })

  it('treats a blank phone string as absent, not as an empty value', () => {
    const details = buildFiduciaryRoleDetailsFromDesignSheet(
      sheetWithHcpSlot(SPOUSE_SLOT),
      [],
      CLIENT,
      { ...SPOUSE, phone: '   ', email: '  ' },
    )

    expect(details.healthcare_agent.primary?.phone).toBeNull()
    expect(details.healthcare_agent.primary?.email).toBeNull()
  })
})
