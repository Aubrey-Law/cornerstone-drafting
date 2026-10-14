import { namedPrincipalSlots } from '@/lib/designSheet/fiduciarySlotOrdering'
import type { DesignSheet, FiduciarySlot, MatterContact } from '@/types/database'
import type { MatterDetailsRow } from '@/types/matter-details'

/**
 * The design sheet owns plan composition — plan type, trust names, credit
 * shelter and the fiduciary appointments. Matter details edits plan type
 * through the plan-type route, which writes this sheet; trust names, credit
 * shelter and appointments stay read-only here and still link back to the
 * sheet. The matter_details PATCH route rejects those keys so they cannot
 * become a second copy.
 *
 * Everything is computed on the server so the matter page ships one flat,
 * already-resolved object instead of the whole design sheet.
 */

/** Sentinels the design sheet uses for the client and spouse themselves. */
const CLIENT_PRIMARY_CONTACT_ID = '__design_sheet_client__'
const SPOUSE_PRIMARY_CONTACT_ID = '__design_sheet_spouse__'

export interface FiduciaryAppointment {
  key: string
  role: string
  primary: string | null
  successor: string | null
}

export interface MatterPlanMirror {
  planType: string | null
  trustName: string | null
  spouseTrustName: string | null
  /** True when the plan carries credit-shelter (two-trust) provisions. */
  creditShelter: boolean
  hasRealEstate: boolean
  hasPets: boolean
  hasMinorChildren: boolean
  /** All ten fiduciary slot arrays, primary and successor, in display order. */
  fiduciaries: FiduciaryAppointment[]
}

export const EMPTY_PLAN_MIRROR: MatterPlanMirror = {
  planType: null,
  trustName: null,
  spouseTrustName: null,
  creditShelter: false,
  hasRealEstate: false,
  hasPets: false,
  hasMinorChildren: false,
  fiduciaries: [],
}

/** The ten fiduciary slot arrays the design sheet keeps, in the order People shows them. */
const FIDUCIARY_ROLES: Array<{ key: keyof DesignSheet & string; role: string }> = [
  { key: 'trustee_slots', role: 'Trustee' },
  { key: 'executor_slots', role: 'Personal representative' },
  { key: 'poa_slots', role: 'POA agent' },
  { key: 'hcp_slots', role: 'Health care agent' },
  { key: 'guardian_slots', role: 'Guardian, minor children' },
  { key: 'temporary_guardian_slots', role: 'Temporary guardian' },
  { key: 'spouse_trustee_slots', role: 'Spouse — trustee' },
  { key: 'spouse_executor_slots', role: 'Spouse — personal representative' },
  { key: 'spouse_poa_slots', role: 'Spouse — POA agent' },
  { key: 'spouse_hcp_slots', role: 'Spouse — health care agent' },
]

function nameOf(contact: MatterContact): string {
  return [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim()
}

/**
 * Resolve a principal slot to a display name, folding each slot's co-agents in
 * as "A & B" — a co-trustee pair reads as one appointment, not two rows.
 */
function slotName(
  slots: FiduciarySlot[],
  priority: number,
  lookup: (contactId: string) => string | null,
): string | null {
  const principal = namedPrincipalSlots(slots)[priority]
  if (!principal?.contact_id) return null
  const names = [
    lookup(principal.contact_id),
    ...slots
      .filter(slot => slot.is_co && slot.order === principal.order && slot.contact_id)
      .sort((a, b) => a.order - b.order)
      .map(slot => lookup(slot.contact_id as string)),
  ].filter((value): value is string => Boolean(value))
  return names.length > 0 ? names.join(' & ') : null
}

function asSlots(value: unknown): FiduciarySlot[] {
  return Array.isArray(value) ? (value as FiduciarySlot[]) : []
}

/**
 * Contact ids appointed in any of the ten fiduciary slot arrays, with the role
 * labels they hold. The client/spouse sentinels are skipped — they are not
 * contact rows. This is how the People tab knows a contact the design sheet
 * appointed is a fiduciary even though no contact profile flag was ever set.
 */
export function appointedFiduciaryRolesByContact(sheet: DesignSheet | null): Map<string, string[]> {
  const rolesByContact = new Map<string, string[]>()
  if (!sheet) return rolesByContact
  for (const { key, role } of FIDUCIARY_ROLES) {
    for (const slot of asSlots(sheet[key])) {
      if (!slot.contact_id || slot.contact_id.startsWith('__')) continue
      const roles = rolesByContact.get(slot.contact_id) ?? []
      if (!roles.includes(role)) roles.push(role)
      rolesByContact.set(slot.contact_id, roles)
    }
  }
  return rolesByContact
}

/**
 * Credit shelter has no dedicated design-sheet column. A two-trust plan is the
 * signal the firm actually records: a married plan with a spouse trust, or a
 * matter flagged for separate trusts. The legacy free-text column stays as a
 * fallback so pre-design-sheet matters still read correctly.
 */
function resolveCreditShelter(
  sheet: DesignSheet | null,
  details: MatterDetailsRow | null,
): boolean {
  if (details?.ep_separate_trusts) return true
  if (sheet?.spouse_trust_name?.trim()) return true
  return Boolean(details?.credit_shelter_provisions?.trim())
}

export function buildMatterPlanMirror(
  sheet: DesignSheet | null,
  contacts: MatterContact[],
  details: MatterDetailsRow | null,
  options: { clientName?: string | null; spouseName?: string | null } = {},
): MatterPlanMirror {
  const byId = new Map(contacts.map(contact => [contact.id, nameOf(contact)]))
  const lookup = (contactId: string): string | null => {
    if (contactId === CLIENT_PRIMARY_CONTACT_ID) return options.clientName?.trim() || 'Client'
    if (contactId === SPOUSE_PRIMARY_CONTACT_ID) return options.spouseName?.trim() || 'Spouse'
    return byId.get(contactId) || null
  }

  const fiduciaries = FIDUCIARY_ROLES.map(({ key, role }) => {
    const slots = asSlots(sheet?.[key])
    return {
      key,
      role,
      primary: slotName(slots, 0, lookup),
      successor: slotName(slots, 1, lookup),
    }
  })

  const sheetAssets = Array.isArray(sheet?.assets) ? sheet.assets : []

  return {
    planType: sheet?.plan_type ?? null,
    trustName: sheet?.trust_name ?? null,
    spouseTrustName: sheet?.spouse_trust_name ?? null,
    creditShelter: resolveCreditShelter(sheet, details),
    hasRealEstate:
      sheetAssets.some(asset => asset.category === 'real_property')
      || Boolean(details?.ep_deed_transfers_needed),
    hasPets: Boolean(sheet?.pet_care_option && sheet.pet_care_option !== 'omit'),
    hasMinorChildren: (sheet?.children ?? []).some(child => child.is_minor),
    fiduciaries,
  }
}
