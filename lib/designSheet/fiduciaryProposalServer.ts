import { fetchDesignSheet, fetchMatterContacts } from '@/lib/queries/matterCore'
import {
  fiduciaryProposalChangesSheet,
  resolveFiduciaryProposals,
  type FiduciaryProposal,
  type ResolvedFiduciaryProposal,
} from '@/lib/designSheet/fiduciaryProposal'
import type { DesignSheet, MatterContact } from '@/types/database'

export interface FiduciaryResolutionContext {
  sheet: DesignSheet
  contacts: MatterContact[]
}

/** The sheet and the people on the matter, as they stand right now. */
export async function loadFiduciaryResolutionContext(matterId: string): Promise<FiduciaryResolutionContext> {
  const [sheet, contacts] = await Promise.all([fetchDesignSheet(matterId), fetchMatterContacts(matterId)])
  if (!sheet) throw new Error('This matter has no design sheet yet')
  return { sheet, contacts }
}

/**
 * Resolve raw appointments against the matter as it stands and keep only the
 * rows that would change the sheet. Run at proposal time so the card shows
 * current occupants, and again at execution so a contact added since is
 * reused rather than minted twice.
 */
export function resolveChangingFiduciaryProposals(
  context: FiduciaryResolutionContext,
  proposals: FiduciaryProposal[],
): ResolvedFiduciaryProposal[] {
  return resolveFiduciaryProposals({ sheet: context.sheet, contacts: context.contacts, proposals })
    .filter(fiduciaryProposalChangesSheet)
}

/** One line per appointment for a review card: who holds the slot now, and who would. */
export function describeFiduciaryChange(row: ResolvedFiduciaryProposal): string {
  const current = row.currentDisplay === '-' ? '(empty)' : row.currentDisplay
  const proposed = row.matchedContactId ? row.fullName : `${row.fullName} (new contact)`
  return `Fiduciaries · ${row.label}: ${current} → ${proposed}`
}
