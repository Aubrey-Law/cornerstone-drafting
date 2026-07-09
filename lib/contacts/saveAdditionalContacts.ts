import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { normalizeContactRelationshipType } from '@/lib/contactRelationship'
import { composedAddressOneLine } from '@/lib/intakeContactAddress'
import { CLIENT_INTAKE_ADDITIONAL_SOURCE } from '@/lib/intakeContactSource'
import { formatPhoneForStorage } from '@/lib/phone'

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

  return {
    middle_name:
      typeof entry.middle_name === 'string' ? entry.middle_name.trim() || null : null,
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

export async function saveAdditionalContacts(
  admin: AdminClient,
  intakeId: string,
  nominees: Array<Record<string, unknown>>,
): Promise<void> {
  const { error: deleteError } = await admin
    .from('contacts')
    .delete()
    .eq('client_intake_id', intakeId)
    .eq('source', CLIENT_INTAKE_ADDITIONAL_SOURCE)
  if (deleteError) throw deleteError

  const rows = nominees
    .filter(
      (contact) =>
        String(contact.first_name ?? '').trim() && String(contact.last_name ?? '').trim(),
    )
    .map((contact) => ({
      client_intake_id: intakeId,
      relationship_type: normalizeContactRelationshipType('other'),
      first_name: String(contact.first_name).trim(),
      last_name: String(contact.last_name).trim(),
      suffix:
        typeof contact.suffix === 'string' && contact.suffix.trim()
          ? contact.suffix.trim()
          : null,
      ...contactPayloadFromEntry(contact),
      source: CLIENT_INTAKE_ADDITIONAL_SOURCE,
      created_by_client_at: new Date().toISOString(),
    }))

  if (rows.length > 0) {
    const { error } = await admin.from('contacts').insert(rows)
    if (error) throw error
  }
}
