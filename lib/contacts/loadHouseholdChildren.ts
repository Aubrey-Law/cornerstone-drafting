import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import type { DesignSheetChild } from '@/types/database'
import { contactRowToDesignSheetChild } from './childMapping'

type AdminClient = SupabaseClient<Database>

/** The child-contact columns contactRowToDesignSheetChild needs. */
const CHILD_FIELDS =
  'id, first_name, last_name, date_of_birth, child_relationship, parentage, is_minor, created_at'

/**
 * Single read surface for the household's children from the authoritative
 * `contacts` table (relationship_type='child'), mapped to the design-sheet /
 * drafting `DesignSheetChild` shape via the SAME mapper the
 * `client_intake.children` mirror is built with (childMapping.contactRowToDesignSheetChild).
 *
 * Because the mirror is `contacts.map(contactRowToDesignSheetChild)`, this helper
 * returns output identical to the legacy `client_intake.children` projection —
 * it is the contacts-sourced replacement for readers of that column. The children
 * analog of loadSpouseContact.
 *
 * Ordered by created_at for a stable roster order.
 */
export async function loadHouseholdChildren(
  admin: AdminClient,
  matterId: string,
): Promise<DesignSheetChild[]> {
  const { data: joinRows, error } = await admin
    .from('matter_contacts')
    .select('contact_id, child_relationship, parentage, is_minor')
    .eq('matter_id', matterId)
    .eq('relationship_type', 'child')
  if (error) throw new Error(error.message)

  const joins = (joinRows ?? []) as Array<Record<string, unknown>>
  if (joins.length === 0) return []

  const { data: contactRows, error: contactsError } = await admin
    .from('contacts')
    .select(CHILD_FIELDS)
    .in('id', joins.map(row => String(row.contact_id)))
  if (contactsError) throw new Error(contactsError.message)

  const contactById = new Map(
    ((contactRows ?? []) as Array<Record<string, unknown>>).map(c => [String(c.id), c]),
  )

  return joins
    // The join row is authoritative for the facts stated relative to this
    // matter; the contact carries the person's own.
    .map((row): Record<string, unknown> => {
      const contact = contactById.get(String(row.contact_id)) ?? {}
      return {
        ...contact,
        child_relationship: row.child_relationship ?? contact.child_relationship ?? null,
        parentage: row.parentage ?? contact.parentage ?? null,
        is_minor: row.is_minor ?? contact.is_minor ?? null,
      }
    })
    // Sorted here rather than in the query, so the roster order stays stable
    // now that the driving query is over the join rather than over contacts.
    .sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
    .map(contactRowToDesignSheetChild)
}
