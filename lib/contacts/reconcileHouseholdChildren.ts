import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { getHouseholdForIntake } from './getHousehold'
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
  // "Add child" puts a blank row in the wizard before anything is typed, and
  // leaving the section saves it. An unnamed row is unfinished input, not a
  // child: drop it here so the writer's all-unnamed guard (which protects
  // against shape mismatches) never fires on ordinary intake use. If nothing
  // named remains, leave the stored children alone rather than wiping them.
  const named = incoming.filter(
    (c) => `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim().length > 0,
  )
  if (incoming.length > 0 && named.length === 0) return

  const household = await getHouseholdForIntake(admin, intakeId)
  const existingByName = new Map(
    household.children.map((c) => [contactKey(c.first_name, c.last_name), c]),
  )
  const existingById = new Map(
    household.children
      .filter((c) => c.contact_id)
      .map((c) => [c.contact_id as string, c]),
  )

  const childContext = {
    clientFirstName: household.self.first_name,
    spouseFirstName: household.spouse?.first_name ?? null,
  }

  const inputs = named.map((c) => {
    const cid = typeof c.contact_id === 'string' ? c.contact_id : null
    const existing =
      (cid ? existingById.get(cid) : undefined) ??
      existingByName.get(contactKey(c.first_name, c.last_name))
    return mergeChildInput(c, existing, childContext)
  })

  await saveHouseholdChildren(admin, intakeId, inputs)
}
