import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { contactRowId, intakeRowId } from '@/lib/adminTables/contactTable'
import { deleteContact } from '@/lib/contacts/deleteContact'
import { deleteLeadPermanently } from '@/lib/leads/removeLead'
import {
  MatterDeletionError,
  matterDeletionConfirmationMessage,
  matterDeletionProtections,
  type DeleteMatterOptions,
  type MatterDeletionProtection,
} from '@/lib/matters/deleteMatter'

export type DeletePersonResult = {
  /** The directory id that was asked for, echoed back. */
  id: string
  source: 'intake' | 'contact'
  /** Every engagement destroyed with the person. Empty for a contact row. */
  intakeIds: string[]
  documentsDeleted: number
  protections: MatterDeletionProtection[]
}

/**
 * Every engagement that belongs to the same person as `intakeId`.
 *
 * A returning client gets a fresh `client_intake` row per engagement but keeps
 * one `self` contact across all of them — the same grouping the People
 * directory merges rows on (`lib/queries/contactsDirectory.ts`). Deleting the
 * person has to follow it: destroying only the row the directory happened to
 * show would leave the other engagements behind, and the person would still be
 * listed afterwards.
 */
async function engagementsOfPerson(
  admin: SupabaseClient,
  intakeId: string,
): Promise<{ intakeIds: string[]; matterIds: string[] }> {
  const { data: intake, error } = await admin
    .from('client_intake')
    .select('id, matter_id')
    .eq('id', intakeId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!intake) throw new MatterDeletionError('Person not found', 'not_found')

  const matterId = (intake.matter_id as string | null) ?? null
  if (!matterId) return { intakeIds: [intakeId], matterIds: [] }

  const { data: selfLink, error: selfError } = await admin
    .from('matter_contacts')
    .select('contact_id')
    .eq('matter_id', matterId)
    .eq('relationship_type', 'self')
    .limit(1)
    .maybeSingle()
  if (selfError) throw new Error(selfError.message)
  // No join row — an intake predating the backfill. It speaks for itself alone.
  if (!selfLink) return { intakeIds: [intakeId], matterIds: [matterId] }

  const { data: links, error: linksError } = await admin
    .from('matter_contacts')
    .select('matter_id')
    .eq('contact_id', selfLink.contact_id)
    .eq('relationship_type', 'self')
  if (linksError) throw new Error(linksError.message)

  const matterIds = [...new Set([
    matterId,
    ...((links ?? []) as Array<{ matter_id: string }>).map(link => link.matter_id),
  ])]

  const { data: siblings, error: siblingsError } = await admin
    .from('client_intake')
    .select('id')
    .in('matter_id', matterIds)
  if (siblingsError) throw new Error(siblingsError.message)

  const intakeIds = [...new Set([
    intakeId,
    ...((siblings ?? []) as Array<{ id: string }>).map(row => row.id),
  ])]

  return { intakeIds, matterIds }
}

/**
 * Permanently remove someone from the firm directory, whichever table they
 * live in.
 *
 * The People list is a union of two things — a `client_intake` row per
 * engagement, and a `contacts` row per spouse, child, fiduciary or standalone
 * entry — so "delete this person" means something different on each side and
 * is dispatched on the namespaced row id the directory already uses.
 *
 * An intake-backed person takes their engagements with them, so every matter
 * involved is asked about its protections up front: one confirmation covering
 * the whole person, raised before anything is destroyed, rather than a delete
 * that stops halfway through with part of their history already gone.
 */
export async function deletePerson(
  admin: SupabaseClient,
  directoryId: string,
  options: DeleteMatterOptions = {},
): Promise<DeletePersonResult> {
  const contactId = contactRowId(directoryId)
  if (contactId) {
    await deleteContact(admin, contactId)
    return { id: directoryId, source: 'contact', intakeIds: [], documentsDeleted: 0, protections: [] }
  }

  // A bare uuid is taken as an intake id, the way the directory's deep links do.
  const intakeId = intakeRowId(directoryId) ?? directoryId
  const { intakeIds, matterIds } = await engagementsOfPerson(admin, intakeId)

  const protections = new Set<MatterDeletionProtection>()
  for (const matterId of matterIds) {
    for (const protection of await matterDeletionProtections(admin, matterId)) {
      protections.add(protection)
    }
  }

  if (protections.size > 0 && !options.confirmProtected) {
    throw new MatterDeletionError(
      matterDeletionConfirmationMessage([...protections]),
      'confirmation_required',
      [...protections],
    )
  }

  let documentsDeleted = 0
  for (const id of intakeIds) {
    try {
      // Confirmed here rather than per engagement: the question was already put
      // once, above, for everything about to go.
      const result = await deleteLeadPermanently(admin, id, { ...options, confirmProtected: true })
      documentsDeleted += result.documentsDeleted
    } catch (error) {
      // An engagement already taken down by an earlier one in this loop — a
      // matter and the intake it points at. Nothing left to do for it; the
      // person not existing at all was caught before any of this ran.
      if (error instanceof MatterDeletionError && error.code === 'not_found') continue
      throw error
    }
  }

  return {
    id: directoryId,
    source: 'intake',
    intakeIds,
    documentsDeleted,
    protections: [...protections],
  }
}
