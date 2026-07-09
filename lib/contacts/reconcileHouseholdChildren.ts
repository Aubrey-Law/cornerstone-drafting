import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { getHousehold } from './getHousehold'
import { mergeChildInput } from './mergeChildInput'
import { saveHouseholdChildren } from './saveHouseholdChildren'

type AdminClient = SupabaseClient<Database>

function contactKey(first: unknown, last: unknown): string {
  return `${String(first ?? '').trim().toLowerCase()}|${String(last ?? '').trim().toLowerCase()}`
}

/** Route-level reconcile for the children section. */
export async function reconcileHouseholdChildren(
  admin: AdminClient,
  intakeId: string,
  incoming: Array<Record<string, unknown>>,
): Promise<void> {
  const household = await getHousehold(admin, intakeId)
  const existingByName = new Map(
    household.children.map((c) => [contactKey(c.first_name, c.last_name), c]),
  )
  const existingById = new Map(
    household.children
      .filter((c) => c.contact_id)
      .map((c) => [c.contact_id as string, c]),
  )

  const inputs = incoming.map((c) => {
    const cid = typeof c.contact_id === 'string' ? c.contact_id : null
    const existing =
      (cid ? existingById.get(cid) : undefined) ??
      existingByName.get(contactKey(c.first_name, c.last_name))
    return mergeChildInput(c, existing)
  })

  await saveHouseholdChildren(admin, intakeId, inputs)
}
