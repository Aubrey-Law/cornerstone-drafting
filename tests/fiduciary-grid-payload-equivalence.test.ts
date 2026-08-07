import { describe, expect, it } from 'vitest'
import {
  toggleFiduciaryGridContact,
} from '@/app/admin/drafting/[matterId]/design/sections/FiduciaryGrid'
import {
  setPrimaryContact,
} from '@/app/admin/drafting/[matterId]/design/sections/fiduciary-blocks'
import {
  addAlternate,
  normalizeFiduciarySlots,
  setSlotContact,
  ROLE_CONFIG,
} from '@/app/admin/drafting/[matterId]/design/sections/fiduciary-helpers'
import { buildFiduciaryRoleDetailsFromDesignSheet } from '@/lib/draftPayload/fiduciaryDetails'
import { buildFiduciariesFromDesignSheet } from '@/lib/draftPayload/helpers'
import type { ContactRow, DesignSheetRow } from '@/lib/draftPayload/types'
import type { FiduciarySlot } from '@/types/database'

function oldBlockSlots(primary: string, alternate: string): FiduciarySlot[] {
  const withPrimary = setPrimaryContact([], primary)
  const withAlternate = addAlternate(withPrimary)
  const alternateSlot = withAlternate.find(slot => slot.order === 1 && !slot.is_co)
  if (!alternateSlot) throw new Error('Expected alternate slot')
  return normalizeFiduciarySlots(setSlotContact(withAlternate, alternateSlot.id, alternate))
}

/**
 * Naming two people for a role through the grid, the way a user does it:
 * click one contact, then click another, without targeting a co line.
 *
 * `trustee` is the strictest case — it allows co-fiduciaries with the highest
 * `maxCo`, so if any role were going to quietly turn the second person into a
 * co-trustee instead of an alternate, this is the one.
 */
function gridSlots(primary: string, alternate: string): FiduciarySlot[] {
  const role = ROLE_CONFIG.trustee
  return toggleFiduciaryGridContact(
    toggleFiduciaryGridContact([], primary, role),
    alternate,
    role,
  )
}

describe('fiduciary grid payload compatibility', () => {
  it('matches old-block payloads after assigning all five roles for both parties', () => {
    const contacts = [
      {
        id: 'alex',
        first_name: 'Alex',
        middle_name: null,
        last_name: 'Morgan',
        preferred_pronoun: null,
        relationship_type: null,
        relationship_label: 'Sibling',
        address_line1: '1 Main Street',
        date_of_birth: null,
        phone: null,
        email: null,
        contact_roles: [],
      },
      {
        id: 'blair',
        first_name: 'Blair',
        middle_name: null,
        last_name: 'Morgan',
        preferred_pronoun: null,
        relationship_type: null,
        relationship_label: 'Sibling',
        address_line1: '2 Main Street',
        date_of_birth: null,
        phone: null,
        email: null,
        contact_roles: [],
      },
    ] as unknown as ContactRow[]

    const clientFields = [
      'trustee_slots',
      'executor_slots',
      'poa_slots',
      'hcp_slots',
      'guardian_slots',
    ] as const
    const spouseFields = [
      'spouse_trustee_slots',
      'spouse_executor_slots',
      'spouse_poa_slots',
      'spouse_hcp_slots',
    ] as const

    const oldSheet: Record<string, unknown> = {}
    const gridSheet: Record<string, unknown> = {}
    for (const field of [...clientFields, ...spouseFields]) {
      oldSheet[field] = oldBlockSlots('alex', 'blair')
      gridSheet[field] = gridSlots('alex', 'blair')
    }

    const client = { full_name: 'Casey Client', address: '10 State Street' }
    const spouse = { full_name: 'Sam Client', address: '10 State Street' }
    const oldRow = oldSheet as unknown as DesignSheetRow
    const gridRow = gridSheet as unknown as DesignSheetRow

    expect(buildFiduciariesFromDesignSheet(gridRow, contacts, client, spouse))
      .toEqual(buildFiduciariesFromDesignSheet(oldRow, contacts, client, spouse))
    expect(buildFiduciaryRoleDetailsFromDesignSheet(gridRow, contacts, client, spouse))
      .toEqual(buildFiduciaryRoleDetailsFromDesignSheet(oldRow, contacts, client, spouse))
  })
})
