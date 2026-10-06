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
  /**
   * Always set, including for `self` — the client is a real `contacts` row
   * since 20260925000000_matter_contacts_join.sql. Identify the client by
   * `relationship_type === 'self'`, never by a null id.
   */
  contact_id: string
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
  matterId: string
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
  contact_id: string,
  roles: HouseholdRole[],
): HouseholdPerson {
  const out = { contact_id, relationship_type, roles, is_minor: false } as HouseholdPerson
  for (const f of PERSON_FIELDS) {
    ;(out as unknown as Record<string, unknown>)[f] = (row[f] ?? null) as unknown
  }
  return out
}

/**
 * Single read surface for every person on a matter, with roles attached.
 *
 * Reads through `matter_contacts` rather than `contacts.client_intake_id`
 * (step 3 of docs/matter-contacts-migration.md), so a person shared between
 * two matters is read once per matter with the relationship *that matter*
 * records. The legacy FK is still written — the step 2 triggers maintain the
 * join from it — but nothing reads it here any more.
 *
 * `self.contact_id` is no longer null: the client is a real `contacts` row.
 * Use `relationship_type === 'self'` to identify them.
 */
export async function getHousehold(admin: AdminClient, matterId: string): Promise<Household> {
  // Two queries rather than an embedded select: `matter_contacts` is absent
  // from packages/db-types/src/supabase.generated.ts until the migration is applied and the
  // types regenerated, and PostgREST embedding needs the relationship to be
  // declared there. Joining in TypeScript costs one round trip and keeps this
  // independent of the generated-type backlog.
  const [{ data: joinRows, error: joinErr }, { data: roleRows, error: rolesErr }] =
    await Promise.all([
      admin
        .from('matter_contacts')
        .select('contact_id, relationship_type, relationship_label, child_relationship, parentage, is_minor')
        .eq('matter_id', matterId),
      admin
        .from('contact_roles')
        .select('contact_id, role, for_party, priority, is_coagent')
        .eq('matter_id', matterId),
    ])

  if (joinErr) throw new Error(joinErr.message)
  if (rolesErr) throw new Error(rolesErr.message)

  const joins = (joinRows ?? []) as Array<Record<string, unknown>>
  const contactIds = joins.map(row => String(row.contact_id))

  const { data: contactRows, error: contactsErr } = contactIds.length
    ? await admin.from('contacts').select('*').in('id', contactIds)
    : { data: [], error: null }
  if (contactsErr) throw new Error(contactsErr.message)

  const contactById = new Map(
    ((contactRows ?? []) as Array<Record<string, unknown>>).map(c => [String(c.id), c]),
  )

  const rolesByContact = new Map<string, HouseholdRole[]>()
  for (const r of (roleRows ?? []) as Array<HouseholdRole & { contact_id: string }>) {
    const list = rolesByContact.get(r.contact_id) ?? []
    list.push({ role: r.role, for_party: r.for_party, priority: r.priority, is_coagent: r.is_coagent })
    rolesByContact.set(r.contact_id, list)
  }

  let self: HouseholdPerson | null = null
  let spouse: HouseholdPerson | null = null
  const children: HouseholdPerson[] = []
  const others: HouseholdPerson[] = []

  for (const row of joins) {
    const id = String(row.contact_id)
    const contact = contactById.get(id) ?? {}
    const roles = rolesByContact.get(id) ?? []
    // The join row is authoritative for the matter-relative facts; the contact
    // row carries the person's intrinsic ones.
    const merged: Record<string, unknown> = {
      ...contact,
      child_relationship: row.child_relationship ?? contact.child_relationship ?? null,
      parentage: row.parentage ?? contact.parentage ?? null,
    }
    const rt = String(row.relationship_type ?? contact.relationship_type ?? 'other')

    if (rt === 'self') self = pickPerson(merged, 'self', id, roles)
    else if (rt === 'spouse') spouse = pickPerson(merged, 'spouse', id, roles)
    else if (rt === 'child') {
      const p = pickPerson(merged, 'child', id, roles)
      const override = (row.is_minor ?? contact.is_minor) as boolean | null | undefined
      p.is_minor = typeof override === 'boolean' ? override : isMinorFromDob(p.date_of_birth)
      children.push(p)
    }
    else others.push(pickPerson(merged, 'other', id, roles))
  }

  if (!self) throw new Error(`matter ${matterId} has no primary client in matter_contacts`)

  return { matterId, self, spouse, children, others }
}

/**
 * The household for an intake id. `getHousehold` is keyed on the matter, and
 * an intake id is not a matter id: passing one finds no join rows and throws
 * "no primary client", which is what failed every intake children save.
 *
 * Resolves the intake's matter and reads through it. A lead filling out the
 * questionnaire before they are hired has no matter yet, so their household is
 * read from the contacts the intake owns instead.
 */
export async function getHouseholdForIntake(admin: AdminClient, intakeId: string): Promise<Household> {
  const { data: matter, error: matterErr } = await admin
    .from('matters')
    .select('id')
    .eq('client_intake_id', intakeId)
    .maybeSingle()
  if (matterErr) throw new Error(matterErr.message)
  const matterId = (matter as { id?: string } | null)?.id
  if (matterId) return getHousehold(admin, matterId)

  const [{ data: contactRows, error: contactsErr }, { data: intakeRow, error: intakeErr }] =
    await Promise.all([
      admin.from('contacts').select('*').eq('client_intake_id', intakeId),
      admin.from('client_intake').select('first_name, last_name').eq('id', intakeId).maybeSingle(),
    ])
  if (contactsErr) throw new Error(contactsErr.message)
  if (intakeErr) throw new Error(intakeErr.message)

  let self: HouseholdPerson | null = null
  let spouse: HouseholdPerson | null = null
  const children: HouseholdPerson[] = []
  const others: HouseholdPerson[] = []

  for (const row of (contactRows ?? []) as Array<Record<string, unknown>>) {
    const id = String(row.id)
    const rt = String(row.relationship_type ?? 'other')
    if (rt === 'self') self = pickPerson(row, 'self', id, [])
    else if (rt === 'spouse') spouse = pickPerson(row, 'spouse', id, [])
    else if (rt === 'child') {
      const p = pickPerson(row, 'child', id, [])
      const override = row.is_minor as boolean | null | undefined
      p.is_minor = typeof override === 'boolean' ? override : isMinorFromDob(p.date_of_birth)
      children.push(p)
    }
    else others.push(pickPerson(row, 'other', id, []))
  }

  // No contacts row for the client yet: the intake row still names them.
  self ??= pickPerson((intakeRow ?? {}) as Record<string, unknown>, 'self', '', [])

  return { matterId: '', self, spouse, children, others }
}
