import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'

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
  email: string | null
  phone: string | null
}

const SPOUSE_FIELDS =
  'first_name, middle_name, last_name, suffix, preferred_name, preferred_pronoun, ' +
  'prior_names, date_of_birth, is_us_citizen, email, phone'

/**
 * Single read surface for the spouse from the authoritative `contacts` table
 * (relationship_type='spouse'). Returns null when the household has no spouse.
 * One query, spouse only — does not load children/roles.
 */
export async function loadSpouseContact(
  admin: AdminClient,
  intakeId: string,
): Promise<SpouseContact | null> {
  const { data, error } = await admin
    .from('contacts')
    .select(SPOUSE_FIELDS)
    .eq('client_intake_id', intakeId)
    .eq('relationship_type', 'spouse')
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as SpouseContact | null) ?? null
}
