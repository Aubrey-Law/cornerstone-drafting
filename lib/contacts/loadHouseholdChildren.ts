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
  clientIntakeId: string,
): Promise<DesignSheetChild[]> {
  const { data, error } = await admin
    .from('contacts')
    .select(CHILD_FIELDS)
    .eq('client_intake_id', clientIntakeId)
    .eq('relationship_type', 'child')
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Array<Record<string, unknown>>).map(contactRowToDesignSheetChild)
}
