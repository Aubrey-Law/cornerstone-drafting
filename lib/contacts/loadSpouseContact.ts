import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import type { CitizenshipStatus } from '@/lib/sharedFields'

type AdminClient = SupabaseClient<Database>

/** The spouse fields every repointed reader needs, sourced from `contacts`. */
export interface SpouseContact {
  first_name: string | null
  middle_name: string | null
  last_name: string | null
  suffix: string | null
  preferred_name: string | null
  preferred_pronoun: string | null
  prior_names: string | null
  date_of_birth: string | null
  is_us_citizen: boolean | null
  citizenship_status: CitizenshipStatus | null
  email: string | null
  phone: string | null
}

const SPOUSE_FIELDS =
  'first_name, middle_name, last_name, suffix, preferred_name, preferred_pronoun, ' +
  'prior_names, date_of_birth, is_us_citizen, citizenship_status, email, phone'

/**
 * Single read surface for a matter's spouse, read through `matter_contacts`
 * (step 3 of docs/matter-contacts-migration.md). Returns null when the matter
 * has no spouse. One query, spouse only — does not load children/roles.
 *
 * `matter_contacts_one_spouse` caps this at one row per matter, so the
 * maybeSingle() here is guaranteed by an index rather than by a household
 * happening to have one matter.
 */
export async function loadSpouseContact(
  admin: AdminClient,
  matterId: string,
  /**
   * Widen when the caller needs more than the name/contact block — the matter
   * header, for instance, formats the spouse's address, which is not in the
   * default set.
   */
  columns: string = SPOUSE_FIELDS,
): Promise<SpouseContact | null> {
  const { data: joinRow, error } = await admin
    .from('matter_contacts')
    .select('contact_id')
    .eq('matter_id', matterId)
    .eq('relationship_type', 'spouse')
    .maybeSingle()
  if (error) throw new Error(error.message)

  const contactId = (joinRow as { contact_id?: string } | null)?.contact_id
  if (!contactId) return null

  const { data, error: contactError } = await admin
    .from('contacts')
    .select(columns)
    .eq('id', contactId)
    .maybeSingle()
  if (contactError) throw new Error(contactError.message)
  return (data as SpouseContact | null) ?? null
}
