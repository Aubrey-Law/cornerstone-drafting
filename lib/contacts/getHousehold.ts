import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { isMinorFromDob } from '@/lib/contacts/childMinor'
import type { CitizenshipStatus } from '@/lib/sharedFields'

type AdminClient = SupabaseClient<Database>

export interface HouseholdRole {
  role: string
  for_party: string
  priority: number
  is_coagent: boolean
}

export interface HouseholdPerson {
  /** null for `self` (stored on the client_intake row, not a contacts row). */
  contact_id: string | null
  relationship_type: 'self' | 'spouse' | 'child' | 'other'
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
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state: string | null
  zip: string | null
  county: string | null
  child_relationship: 'biological' | 'adopted' | 'stepchild' | null
  parentage: 'joint' | 'client' | 'spouse' | null
  is_minor: boolean
  roles: HouseholdRole[]
}

export interface Household {
  intakeId: string
  self: HouseholdPerson
  spouse: HouseholdPerson | null
  children: HouseholdPerson[]
  others: HouseholdPerson[]
}

const PERSON_FIELDS = [
  'first_name', 'middle_name', 'last_name', 'suffix', 'preferred_name', 'preferred_pronoun',
  'prior_names', 'date_of_birth', 'is_us_citizen', 'citizenship_status', 'email', 'phone',
  'address_line1', 'address_line2', 'city', 'state', 'zip', 'county',
  'child_relationship', 'parentage',
] as const

function pickPerson(
  row: Record<string, unknown>,
  relationship_type: HouseholdPerson['relationship_type'],
  contact_id: string | null,
  roles: HouseholdRole[],
): HouseholdPerson {
  const out = { contact_id, relationship_type, roles, is_minor: false } as HouseholdPerson
  for (const f of PERSON_FIELDS) {
    ;(out as unknown as Record<string, unknown>)[f] = (row[f] ?? null) as unknown
  }
  return out
}

/** Single read surface for every person in a household, with roles attached. */
export async function getHousehold(admin: AdminClient, intakeId: string): Promise<Household> {
  const [{ data: intake, error: intakeErr }, { data: contactRows, error: contactsErr }, { data: roleRows, error: rolesErr }] =
    await Promise.all([
      admin.from('client_intake').select('*').eq('id', intakeId).maybeSingle(),
      admin.from('contacts').select('*').eq('client_intake_id', intakeId),
      admin.from('contact_roles').select('contact_id, role, for_party, priority, is_coagent').eq('client_intake_id', intakeId),
    ])

  if (intakeErr) throw new Error(intakeErr.message)
  if (!intake) throw new Error(`client_intake ${intakeId} not found`)
  if (contactsErr) throw new Error(contactsErr.message)
  if (rolesErr) throw new Error(rolesErr.message)

  const rolesByContact = new Map<string, HouseholdRole[]>()
  for (const r of (roleRows ?? []) as Array<HouseholdRole & { contact_id: string }>) {
    const list = rolesByContact.get(r.contact_id) ?? []
    list.push({ role: r.role, for_party: r.for_party, priority: r.priority, is_coagent: r.is_coagent })
    rolesByContact.set(r.contact_id, list)
  }

  const self = pickPerson(intake as Record<string, unknown>, 'self', null, [])
  let spouse: HouseholdPerson | null = null
  const children: HouseholdPerson[] = []
  const others: HouseholdPerson[] = []

  for (const c of (contactRows ?? []) as Array<Record<string, unknown>>) {
    const id = String(c.id)
    const rt = String(c.relationship_type ?? 'other')
    const roles = rolesByContact.get(id) ?? []
    if (rt === 'spouse') spouse = pickPerson(c, 'spouse', id, roles)
    else if (rt === 'child') {
      const p = pickPerson(c, 'child', id, roles)
      const override = c.is_minor as boolean | null | undefined
      p.is_minor = typeof override === 'boolean' ? override : isMinorFromDob(p.date_of_birth)
      children.push(p)
    }
    else others.push(pickPerson(c, 'other', id, roles))
  }

  return { intakeId, self, spouse, children, others }
}
