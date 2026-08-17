/**
 * Proposing fiduciaries — the roles an AI-assisted fill has to be able to touch
 * for the result to be worth anything, because unfilled fiduciary slots are what
 * actually blocks Generate (see designSheetReadiness's primaryContactId checks).
 *
 * Fiduciaries are people, not strings, so they cannot ride in the field proposal
 * map: accepting one may have to mint a `contacts` row before there is an id to
 * store. That makes them a second proposal kind with its own review rows.
 *
 * Which store: the design sheet's own `*_slots` arrays, keyed by `contact_id`.
 * `contact_roles` is the intake/admin-sheet store and is deliberately NOT written
 * here — readiness and buildDraftPayload resolve the sheet's fiduciaries from the
 * slot arrays, and `persistFiduciaryRoles` is a wipe-and-recreate writer whose
 * scope (all managed roles at priorities 1-2 for a party) would delete
 * intake-captured appointments this proposal never mentioned.
 *
 * The legacy scalar columns (`trustee_primary`, …) are left alone. They are a
 * read-time fallback in draftPayload only, and writing them was the old import
 * path's mistake: it set names that readiness never looked at, so an import
 * appeared to fill fiduciaries while the blockers stayed exactly where they were.
 */
import { namedPrincipalSlots } from '@/lib/designSheet/fiduciarySlotOrdering'
import type { DesignSheet, FiduciarySlot } from '@/types/database'

export type FiduciaryProposalRole =
  | 'trustee'
  | 'executor'
  | 'poa'
  | 'hcp'
  | 'guardian'
  | 'temporary_guardian'

export type FiduciaryProposalParty = 'client' | 'spouse'

export interface FiduciaryProposal {
  role: FiduciaryProposalRole
  party: FiduciaryProposalParty
  /** 0 = primary, 1 = alternate, 2 = second alternate. */
  priority: number
  is_co: boolean
  first_name: string
  last_name: string
  relationship?: string | null
}

export interface ResolvedFiduciaryProposal extends FiduciaryProposal {
  /** Stable identity for the review checkbox and the accept payload. */
  id: string
  slotField: FiduciarySlotField
  label: string
  fullName: string
  /** The matter contact this name resolves to, or null when it needs creating. */
  matchedContactId: string | null
  /** Who currently occupies the slot, for the review row. */
  currentDisplay: string
  replacement: boolean
  selected: boolean
}

export type FiduciarySlotField = Extract<
  keyof DesignSheet,
  | 'trustee_slots' | 'executor_slots' | 'poa_slots' | 'hcp_slots'
  | 'guardian_slots' | 'temporary_guardian_slots'
  | 'spouse_trustee_slots' | 'spouse_executor_slots'
  | 'spouse_poa_slots' | 'spouse_hcp_slots'
>

const CLIENT_SLOT_FIELDS: Record<FiduciaryProposalRole, FiduciarySlotField> = {
  trustee: 'trustee_slots',
  executor: 'executor_slots',
  poa: 'poa_slots',
  hcp: 'hcp_slots',
  guardian: 'guardian_slots',
  temporary_guardian: 'temporary_guardian_slots',
}

// Guardians are a household appointment with no spouse-side counterpart on the
// sheet, so a spouse-party guardian proposal has nowhere to go and is dropped.
const SPOUSE_SLOT_FIELDS: Partial<Record<FiduciaryProposalRole, FiduciarySlotField>> = {
  trustee: 'spouse_trustee_slots',
  executor: 'spouse_executor_slots',
  poa: 'spouse_poa_slots',
  hcp: 'spouse_hcp_slots',
}

const ROLE_LABELS: Record<FiduciaryProposalRole, string> = {
  trustee: 'Trustee',
  executor: 'Personal representative',
  poa: 'Attorney-in-fact',
  hcp: 'Health care agent',
  guardian: 'Guardian',
  temporary_guardian: 'Temporary guardian',
}

const PRIORITY_LABELS = ['primary', 'alternate', 'second alternate']

export const FIDUCIARY_PROPOSAL_ROLES = Object.keys(CLIENT_SLOT_FIELDS) as FiduciaryProposalRole[]

export function fiduciarySlotField(
  role: FiduciaryProposalRole,
  party: FiduciaryProposalParty,
): FiduciarySlotField | null {
  return party === 'spouse' ? SPOUSE_SLOT_FIELDS[role] ?? null : CLIENT_SLOT_FIELDS[role]
}

export function fiduciaryProposalLabel(proposal: Pick<FiduciaryProposal, 'role' | 'party' | 'priority' | 'is_co'>): string {
  const who = proposal.party === 'spouse' ? 'Spouse ' : ''
  const rank = PRIORITY_LABELS[proposal.priority] ?? `alternate ${proposal.priority}`
  const co = proposal.is_co ? ' co-agent' : ''
  return `${who}${ROLE_LABELS[proposal.role]}${co} — ${rank}`
}

export function fiduciaryProposalId(proposal: Pick<FiduciaryProposal, 'role' | 'party' | 'priority' | 'is_co'>): string {
  return `${proposal.party}:${proposal.role}:${proposal.priority}:${proposal.is_co ? 'co' : 'seq'}`
}

function nameKey(first: unknown, last: unknown): string {
  return `${String(first ?? '').trim().toLowerCase()}|${String(last ?? '').trim().toLowerCase()}`
}

export interface ProposalContact {
  id: string
  first_name: string | null
  last_name: string | null
}

function contactDisplayName(contact: ProposalContact | undefined): string {
  if (!contact) return '-'
  return [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim() || '-'
}

/**
 * Turn raw model output into review rows: match each name against the people
 * already on the matter, and describe what accepting would displace.
 *
 * A proposal whose role/party pair has no slot on the sheet is dropped rather
 * than redirected — silently moving a spouse guardian onto the client's guardian
 * line would be a worse outcome than not proposing it.
 */
export function resolveFiduciaryProposals(args: {
  sheet: Pick<DesignSheet, FiduciarySlotField>
  contacts: ProposalContact[]
  proposals: FiduciaryProposal[]
}): ResolvedFiduciaryProposal[] {
  const byName = new Map<string, ProposalContact>()
  for (const contact of args.contacts) {
    byName.set(nameKey(contact.first_name, contact.last_name), contact)
  }
  const byId = new Map(args.contacts.map(contact => [contact.id, contact]))

  const seen = new Set<string>()
  const rows: ResolvedFiduciaryProposal[] = []

  for (const proposal of args.proposals) {
    const first = proposal.first_name?.trim()
    const last = proposal.last_name?.trim()
    if (!first || !last) continue

    const slotField = fiduciarySlotField(proposal.role, proposal.party)
    if (!slotField) continue

    const id = fiduciaryProposalId(proposal)
    // One row per slot: a model that names two people for the same line gets the
    // first, rather than a review list with two contradictory rows for one slot.
    if (seen.has(id)) continue
    seen.add(id)

    const slots = (args.sheet[slotField] ?? []) as FiduciarySlot[]
    const occupantId = proposal.is_co
      ? slots.find(slot => slot.is_co && slot.order === proposal.priority)?.contact_id ?? null
      : namedPrincipalSlots(slots)[proposal.priority]?.contact_id ?? null

    const matched = byName.get(nameKey(first, last)) ?? null
    const currentDisplay = occupantId ? contactDisplayName(byId.get(occupantId)) : '-'
    const replacement = Boolean(occupantId) && occupantId !== matched?.id

    rows.push({
      ...proposal,
      first_name: first,
      last_name: last,
      id,
      slotField,
      label: fiduciaryProposalLabel(proposal),
      fullName: `${first} ${last}`,
      matchedContactId: matched?.id ?? null,
      currentDisplay,
      replacement,
      // Two reasons a row starts unchecked: it would displace someone, or it
      // would mint a new contact record. Both deserve a deliberate click.
      selected: !replacement && Boolean(matched),
    })
  }

  return rows
}

/**
 * Build the slot-array patch for accepted proposals.
 *
 * `contactIdByProposalId` carries the ids the caller resolved — matched contacts
 * for rows that had one, freshly created ones for rows that did not. A proposal
 * with no id is skipped rather than written as an empty slot, which
 * repairFiduciarySlotOrdering would drop anyway.
 */
export function applyFiduciaryProposalsToSheet(args: {
  sheet: Pick<DesignSheet, FiduciarySlotField>
  accepted: ResolvedFiduciaryProposal[]
  contactIdByProposalId: Record<string, string>
}): Partial<Pick<DesignSheet, FiduciarySlotField>> {
  const patch: Partial<Record<FiduciarySlotField, FiduciarySlot[]>> = {}

  for (const proposal of args.accepted) {
    const contactId = args.contactIdByProposalId[proposal.id]
    if (!contactId) continue

    const field = proposal.slotField
    const slots = [...(patch[field] ?? (args.sheet[field] ?? []) as FiduciarySlot[])]

    // Orders are the persisted positions; the principal at review-priority N is
    // the Nth *named* principal, which is not the same thing on a sheet carrying
    // blank placeholders. Resolve through the same helper readiness uses.
    const principals = namedPrincipalSlots(slots)
    const targetOrder = proposal.is_co
      ? principals[proposal.priority]?.order ?? proposal.priority
      : principals[proposal.priority]?.order
        ?? (principals.length ? Math.max(...principals.map(s => s.order)) + 1 : 0)

    const existingIndex = slots.findIndex(
      slot => slot.order === targetOrder && slot.is_co === proposal.is_co,
    )

    if (existingIndex >= 0) {
      slots[existingIndex] = { ...slots[existingIndex], contact_id: contactId }
    } else {
      slots.push({
        id: `${field}-${targetOrder}-${proposal.is_co ? 'co' : 'seq'}`,
        contact_id: contactId,
        is_co: proposal.is_co,
        order: targetOrder,
      })
    }

    patch[field] = slots
  }

  return patch as Partial<Pick<DesignSheet, FiduciarySlotField>>
}
