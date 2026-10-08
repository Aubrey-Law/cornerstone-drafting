import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { normalizeContactRelationshipType } from '@/lib/contactRelationship'
import { composedAddressOneLine } from '@/lib/intakeContactAddress'
import { CLIENT_INTAKE_ADDITIONAL_SOURCE } from '@/lib/intakeContactSource'
import { formatPhoneForStorage } from '@/lib/phone'
import { attachContactToMatter, matterIdForIntake } from '@/lib/contacts/attachContactToMatter'

type AdminClient = SupabaseClient<Database>

function contactPayloadFromEntry(entry: Record<string, unknown>) {
  const line =
    composedAddressOneLine({
      street: entry.street,
      city: entry.city,
      state: entry.state,
      zip: entry.zip,
    }) ??
    (typeof entry.address === 'string' && entry.address.trim() ? entry.address.trim() : null)

  const pronoun = entry.preferred_pronoun ?? entry.pronouns

  return {
    middle_name:
      typeof entry.middle_name === 'string' ? entry.middle_name.trim() || null : null,
    preferred_pronoun: typeof pronoun === 'string' ? pronoun.trim() || null : null,
    phone: formatPhoneForStorage(typeof entry.phone === 'string' ? entry.phone : ''),
    email: (entry.email as string | undefined)?.trim() || null,
    address_line1: line,
    city: typeof entry.city === 'string' ? entry.city.trim() || null : null,
    state: typeof entry.state === 'string' ? entry.state.trim() || null : null,
    zip: typeof entry.zip === 'string' ? entry.zip.trim() || null : null,
    relationship_label:
      typeof entry.relationship === 'string'
        ? entry.relationship.trim() || null
        : null,
  }
}

export class AdditionalContactInputError extends Error {}

function contactKey(first: unknown, last: unknown) {
  return `${String(first ?? '').trim().toLowerCase()}|${String(last ?? '').trim().toLowerCase()}`
}

export async function saveAdditionalContacts(
  admin: AdminClient,
  intakeId: string,
  nominees: Array<Record<string, unknown>>,
): Promise<void> {
  // Preserve identities: replacing these rows cascades into contact_roles,
  // even when the client has not changed any fiduciary appointments.
  const { data: existing, error: readError } = await admin
    .from('contacts')
    .select('id, first_name, middle_name, last_name, suffix, preferred_pronoun, phone, email, address_line1, city, state, zip, relationship_label, relationship_type, source, client_intake_id')
    .eq('client_intake_id', intakeId)
    .eq('source', CLIENT_INTAKE_ADDITIONAL_SOURCE)
  if (readError) throw new Error(readError.message)
  const scoped = (existing ?? []) as Array<Record<string, unknown> & { id: string; first_name: string; last_name: string }>
  const scopedIds = new Set(scoped.map((row) => row.id))
  const claimed = new Set<string>()
  const newNames = new Set<string>()
  const newIds = new Set<string>()
  const named: Record<string, unknown>[] = (nominees ?? []).filter(
    (c: Record<string, unknown>) => String(c.first_name ?? '').trim() && String(c.last_name ?? '').trim(),
  )
  const matches: Array<string | null> = []
  const insertIds: Array<string | undefined> = []
  // Validate the entire replacement before any mutation. A supplied ID is
  // authoritative, but only within this intake's additional-contact set.
  for (const entry of named) {
    const explicitId = typeof entry.contact_id === 'string' && entry.contact_id.trim() ? entry.contact_id.trim() : null
    if (explicitId && !scopedIds.has(explicitId)) throw new AdditionalContactInputError('Contact does not belong to this intake contact list')
    // Hydrated additional rows use `id`; newly added rows also have a local
    // UUID. Only an id found in the scoped set can become an update target.
    const id = explicitId ?? (typeof entry.id === 'string' && scopedIds.has(entry.id) ? entry.id : null)
    const name = contactKey(entry.first_name, entry.last_name)
    const candidates = id ? [] : scoped.filter((row) => contactKey(row.first_name, row.last_name) === name)
    if (candidates.length > 1) throw new AdditionalContactInputError('Ambiguous contact name; reload the questionnaire before saving')
    const matched = id ?? candidates[0]?.id ?? null
    if (matched ? claimed.has(matched) : newNames.has(name)) throw new AdditionalContactInputError('Duplicate contact in questionnaire')
    const localId = !matched && typeof entry.id === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(entry.id) ? entry.id.toLowerCase() : undefined
    if (localId && newIds.has(localId)) throw new AdditionalContactInputError('Duplicate contact in questionnaire')
    if (localId) newIds.add(localId)
    if (matched) claimed.add(matched)
    else newNames.add(name)
    matches.push(matched)
    insertIds.push(localId)
  }

  const rows = named.map((c: Record<string, unknown>) => {
    const patch = contactPayloadFromEntry(c)
    return {
      client_intake_id: intakeId,
      relationship_type: normalizeContactRelationshipType('other'),
      first_name: String(c.first_name).trim(),
      last_name: String(c.last_name).trim(),
      suffix: typeof c.suffix === 'string' && c.suffix.trim() ? c.suffix.trim() : null,
      ...patch,
      source: CLIENT_INTAKE_ADDITIONAL_SOURCE,
    }
  })

  const additionalMatterId = rows.length ? await matterIdForIntake(admin, intakeId) : null
  for (const [index, row] of rows.entries()) {
    const matched = matches[index]
    const previous = scoped.find((contact) => contact.id === matched)
    if (previous && Object.entries(row).every(([key, value]) => (previous[key] ?? null) === (value ?? null))) {
      // Autosave and explicit block-save share this writer. An acknowledged
      // contact snapshot needs no second UPDATE; still retry its membership.
      await attachContactToMatter(admin, additionalMatterId, previous.id, { relationship_type: row.relationship_type })
      continue
    }
    const query = matched
      ? admin.from('contacts').update(row).eq('id', matched).eq('client_intake_id', intakeId).eq('source', CLIENT_INTAKE_ADDITIONAL_SOURCE)
      // Keep a new row's UUID stable before the next page hydration. This
      // is INSERT, never upsert: an out-of-scope ID collision must fail.
      : admin.from('contacts').insert({ ...row, ...(insertIds[index] ? { id: insertIds[index] } : {}), created_by_client_at: new Date().toISOString() })
    const { data: saved, error } = await query.select('id, relationship_type').single()
    if (error) throw error
    if (!saved) throw new Error('Contact save returned no record')
    // Re-attach on retry too: a previous insert may have succeeded before a
    // membership failure. The attachment operation is idempotent.
    await attachContactToMatter(admin, additionalMatterId, saved.id, { relationship_type: saved.relationship_type ?? 'other' })
  }
  const removed = scoped.filter((row) => !claimed.has(row.id)).map((row) => row.id)
  if (removed.length) {
    const { error: deleteError } = await admin.from('contacts').delete()
      .eq('client_intake_id', intakeId).eq('source', CLIENT_INTAKE_ADDITIONAL_SOURCE).in('id', removed)
    if (deleteError) throw new Error(deleteError.message)
  }
}
