import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { getHousehold } from './getHousehold'
import { saveHouseholdChildren } from './saveHouseholdChildren'

type AdminClient = SupabaseClient<Database>

/** Rebuild design_sheets.children from the authoritative contacts child set.
 *  Call after any path that inserts/updates a child contact outside saveHouseholdChildren. */
export async function syncChildrenProjection(admin: AdminClient, intakeId: string): Promise<void> {
  const household = await getHousehold(admin, intakeId)
  if (household.children.length === 0) return

  await saveHouseholdChildren(
    admin,
    intakeId,
    household.children.map((c) => ({
      contact_id: c.contact_id,
      first_name: c.first_name ?? '',
      middle_name: c.middle_name,
      last_name: c.last_name ?? '',
      dob: c.date_of_birth,
      relationship: c.child_relationship ?? 'biological',
      parentage: c.parentage,
      is_minor: c.is_minor,
    })),
  )
}
