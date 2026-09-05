import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'

type AdminClient = SupabaseClient<Database>

/**
 * Every `contacts` row on a matter, read through `matter_contacts` (step 3 of
 * docs/matter-contacts-migration.md).
 *
 * The drop-in replacement for `from('contacts').eq('client_intake_id', …)` in
 * readers that want whole contact rows: drafting's fiduciary-slot resolution,
 * the template preview, the matter People tab. Callers that need the
 * relationship *as this matter records it* should use `getHousehold` instead —
 * this returns the person rows, and the join row's matter-relative fields are
 * merged over the contact's own so a person shared between two matters reads
 * correctly on each.
 *
 * Two queries rather than an embedded select: `matter_contacts` is absent from
 * packages/db-types/src/supabase.generated.ts until the migration is applied and the types
 * regenerated.
 */
export async function loadMatterContacts(
  admin: AdminClient,
  matterId: string,
  columns = '*',
): Promise<Array<Record<string, unknown>>> {
  const byMatter = await loadMatterContactsForMatters(admin, [matterId], columns)
  return byMatter.get(matterId) ?? []
}

/**
 * The batched form, grouped by matter. Lists that would otherwise read contacts
 * once per row — the leads list, the calendar attention feed — use this to keep
 * the flip from turning one query into N.
 */
export async function loadMatterContactsForMatters(
  admin: AdminClient,
  matterIds: string[],
  columns = '*',
): Promise<Map<string, Array<Record<string, unknown>>>> {
  const out = new Map<string, Array<Record<string, unknown>>>()
  const ids = [...new Set(matterIds.filter(Boolean))]
  if (ids.length === 0) return out

  const { data: joinRows, error } = await admin
    .from('matter_contacts')
    .select('matter_id, contact_id, relationship_type, relationship_label, child_relationship, parentage, is_minor')
    .in('matter_id', ids)
  if (error) throw new Error(error.message)

  const joins = (joinRows ?? []) as Array<Record<string, unknown>>
  if (joins.length === 0) return out

  const { data: contactRows, error: contactsError } = await admin
    .from('contacts')
    .select(columns)
    .in('id', [...new Set(joins.map(row => String(row.contact_id)))])
  if (contactsError) throw new Error(contactsError.message)

  const contactById = new Map(
    ((contactRows ?? []) as unknown as Array<Record<string, unknown>>).map(c => [String(c.id), c]),
  )

  for (const row of joins) {
    const contact = contactById.get(String(row.contact_id))
    // A join row whose contact is gone would otherwise read as a blank person.
    if (!contact) continue
    const matterId = String(row.matter_id)
    const merged: Record<string, unknown> = {
      ...contact,
      relationship_type: row.relationship_type ?? contact.relationship_type ?? null,
      relationship_label: row.relationship_label ?? contact.relationship_label ?? null,
      child_relationship: row.child_relationship ?? contact.child_relationship ?? null,
      parentage: row.parentage ?? contact.parentage ?? null,
      is_minor: row.is_minor ?? contact.is_minor ?? null,
    }
    out.set(matterId, [...(out.get(matterId) ?? []), merged])
  }

  return out
}
