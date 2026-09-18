import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

export type ContactDeletionErrorCode = 'not_found' | 'blocked'

/** A refusal the caller can act on, as opposed to an infrastructure failure. */
export class ContactDeletionError extends Error {
  readonly code: ContactDeletionErrorCode

  constructor(message: string, code: ContactDeletionErrorCode) {
    super(message)
    this.name = 'ContactDeletionError'
    this.code = code
  }
}

export type DeleteContactResult = {
  contactId: string
  name: string
}

function contactName(contact: { first_name?: string | null; last_name?: string | null; preferred_name?: string | null }): string {
  const first = contact.preferred_name?.trim() || contact.first_name?.trim() || ''
  const last = contact.last_name?.trim() || ''
  return [first, last].filter(Boolean).join(' ') || 'this contact'
}

/**
 * Permanently remove a person from the firm directory — a spouse, a child, a
 * fiduciary, or somebody typed straight into the contact book.
 *
 * The directory has no archive of its own, so this is the only way a wrong or
 * duplicated person leaves it. Everything that points at a contact either
 * cascades (its roles, its matter links) or falls back to null (the emails,
 * texts and calls it was attributed to), so the correspondence survives the
 * person's record.
 *
 * Refused for the one contact that is not just a directory entry: the person a
 * matter is *for*. Deleting that row would leave the matter with no record of
 * whose it is, and the matter — or the lead behind it — is what should go
 * instead. It takes this contact with it.
 */
export async function deleteContact(
  admin: SupabaseClient,
  contactId: string,
): Promise<DeleteContactResult> {
  const { data: contact, error } = await admin
    .from('contacts')
    .select('id, first_name, last_name, preferred_name, relationship_type')
    .eq('id', contactId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!contact) throw new ContactDeletionError('Contact not found', 'not_found')

  const name = contactName(contact)

  if (contact.relationship_type === 'self' || contact.relationship_type === 'client') {
    throw new ContactDeletionError(
      `${name} is the client on their own record. Delete that lead or matter instead — it removes this contact with it.`,
      'blocked',
    )
  }

  const { data: ownRecord, error: ownRecordError } = await admin
    .from('matter_contacts')
    .select('matter_id')
    .eq('contact_id', contactId)
    .eq('relationship_type', 'self')
    .limit(1)
    .maybeSingle()
  if (ownRecordError) throw new Error(ownRecordError.message)
  if (ownRecord) {
    throw new ContactDeletionError(
      `${name} is the client on a matter of their own. Delete that matter instead — it removes this contact with it.`,
      'blocked',
    )
  }

  // contact_roles cascades from contacts, but the RPC this replaces cleared it
  // explicitly and environments predating that constraint still exist. Doing it
  // first costs one statement and cannot leave an orphan behind.
  const { error: rolesError } = await admin.from('contact_roles').delete().eq('contact_id', contactId)
  if (rolesError) throw new Error(rolesError.message)

  const { error: deleteError } = await admin.from('contacts').delete().eq('id', contactId)
  if (deleteError) throw new Error(deleteError.message)

  return { contactId, name }
}
