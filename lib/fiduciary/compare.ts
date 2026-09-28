import type { FiduciaryAppointment } from '@/lib/matter/planMirror'
import type { FiduciaryRole, ForParty } from './matrix'
import type { FiduciaryChainView } from './view'

/**
 * The matter keeps its fiduciaries in two places: the design sheet's slots,
 * which the documents are drafted from, and the roles recorded on the matter's
 * people, which the fiduciary check and its tasks read. They should agree.
 * This lines the two up office by office so the People tab can say where they
 * do not.
 */

/** Which recorded office each design-sheet slot array corresponds to. */
const SLOT_OFFICE: Record<string, { role: FiduciaryRole; forParty: ForParty } | null> = {
  trustee_slots: { role: 'trustee', forParty: 'client' },
  executor_slots: { role: 'personal_rep', forParty: 'client' },
  poa_slots: { role: 'poa', forParty: 'client' },
  hcp_slots: { role: 'hcp', forParty: 'client' },
  guardian_slots: { role: 'guardian', forParty: 'client' },
  // The check records no temporary guardian, so there is nothing to compare.
  temporary_guardian_slots: null,
  spouse_trustee_slots: { role: 'trustee', forParty: 'spouse' },
  spouse_executor_slots: { role: 'personal_rep', forParty: 'spouse' },
  spouse_poa_slots: { role: 'poa', forParty: 'spouse' },
  spouse_hcp_slots: { role: 'hcp', forParty: 'spouse' },
}

export type OfficeAgreement = 'agree' | 'differs' | 'sheet_only' | 'people_only' | 'not_compared'

export interface OfficeComparison {
  key: string
  role: string
  sheetPrimary: string | null
  sheetSuccessor: string | null
  /** Names recorded on people for this office, in order of service; null when there is no counterpart. */
  recorded: string[] | null
  agreement: OfficeAgreement
}

const tokens = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

/**
 * The same person, allowing for a middle name on one side only: the design
 * sheet shows first and last, the people records may carry a middle name.
 * A co-agent pair ("A & B") is compared on its first name.
 */
export function samePerson(sheetName: string, recordedName: string): boolean {
  const sheet = tokens(sheetName.split(' & ')[0] ?? '')
  const recorded = tokens(recordedName)
  if (sheet.length === 0 || recorded.length === 0) return false
  const first = sheet[0]
  const last = sheet[sheet.length - 1]
  return recorded[0] === first && recorded[recorded.length - 1] === last
}

export function compareOffices(
  sheet: readonly FiduciaryAppointment[],
  chains: readonly FiduciaryChainView[],
): OfficeComparison[] {
  return sheet.map(slot => {
    const office = SLOT_OFFICE[slot.key] ?? null
    const chain = office
      ? chains.find(candidate => candidate.roleKey === office.role && candidate.forParty === office.forParty)
      : undefined
    // Co-agents serve alongside the principal, so only principals are in the order of service.
    const recorded = office ? (chain?.people.filter(person => !person.isCoagent).map(person => person.name) ?? []) : null

    let agreement: OfficeAgreement
    if (recorded === null) agreement = 'not_compared'
    else if (!slot.primary && recorded.length === 0) agreement = 'agree'
    else if (!slot.primary) agreement = 'people_only'
    else if (recorded.length === 0) agreement = 'sheet_only'
    else {
      const primaryMatches = samePerson(slot.primary, recorded[0])
      const successorMatches = !slot.successor || (recorded[1] !== undefined && samePerson(slot.successor, recorded[1]))
      agreement = primaryMatches && successorMatches ? 'agree' : 'differs'
    }

    return {
      key: slot.key,
      role: slot.role,
      sheetPrimary: slot.primary,
      sheetSuccessor: slot.successor,
      recorded,
      agreement,
    }
  })
}
