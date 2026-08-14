import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import type { FiduciarySlot } from '@/types/database'
import { joinFiduciaryName } from '@/lib/adminIntakeFiduciaries'
import { designSlotKeyForContactRole } from '@/lib/sharedFields/fiduciaries'

type AdminClient = SupabaseClient<Database>

export type IntakeFiduciarySlotKey =
  | 'trustee_slots'
  | 'executor_slots'
  | 'poa_slots'
  | 'hcp_slots'
  | 'guardian_slots'
  | 'spouse_trustee_slots'
  | 'spouse_executor_slots'
  | 'spouse_poa_slots'
  | 'spouse_hcp_slots'

export interface IntakeFiduciaryFlatFields {
  trustee_primary: string | null
  trustee_alternate: string | null
  executor_primary: string | null
  executor_alternate: string | null
  poa_primary: string | null
  poa_alternate: string | null
  hcp_primary: string | null
  hcp_alternate: string | null
  guardian_primary: string | null
  guardian_alternate: string | null
}

export interface IntakeFiduciarySnapshot extends IntakeFiduciaryFlatFields {
  trustee_slots: FiduciarySlot[] | null
  executor_slots: FiduciarySlot[] | null
  poa_slots: FiduciarySlot[] | null
  hcp_slots: FiduciarySlot[] | null
  guardian_slots: FiduciarySlot[] | null
  spouse_trustee_slots: FiduciarySlot[] | null
  spouse_executor_slots: FiduciarySlot[] | null
  spouse_poa_slots: FiduciarySlot[] | null
  spouse_hcp_slots: FiduciarySlot[] | null
}

type ContactRoleRow = {
  role: string
  for_party: string
  priority: number | null
  is_coagent: boolean | null
}

type ContactWithRoles = {
  id: string
  first_name: string | null
  last_name: string | null
  contact_roles: ContactRoleRow[]
}

const CLIENT_FLAT_MAP: Array<{ role: string; priority: number; field: keyof IntakeFiduciaryFlatFields }> = [
  { role: 'trustee', priority: 1, field: 'trustee_primary' },
  { role: 'trustee', priority: 2, field: 'trustee_alternate' },
  { role: 'personal_rep', priority: 1, field: 'executor_primary' },
  { role: 'personal_rep', priority: 2, field: 'executor_alternate' },
  { role: 'poa', priority: 1, field: 'poa_primary' },
  { role: 'poa', priority: 2, field: 'poa_alternate' },
  { role: 'hcp', priority: 1, field: 'hcp_primary' },
  { role: 'hcp', priority: 2, field: 'hcp_alternate' },
  { role: 'guardian', priority: 1, field: 'guardian_primary' },
  { role: 'guardian', priority: 2, field: 'guardian_alternate' },
]

const SLOT_KEYS: IntakeFiduciarySlotKey[] = [
  'trustee_slots',
  'executor_slots',
  'poa_slots',
  'hcp_slots',
  'guardian_slots',
  'spouse_trustee_slots',
  'spouse_executor_slots',
  'spouse_poa_slots',
  'spouse_hcp_slots',
]

function emptyFlat(): IntakeFiduciaryFlatFields {
  return {
    trustee_primary: null,
    trustee_alternate: null,
    executor_primary: null,
    executor_alternate: null,
    poa_primary: null,
    poa_alternate: null,
    hcp_primary: null,
    hcp_alternate: null,
    guardian_primary: null,
    guardian_alternate: null,
  }
}

function flatFromIntakeColumns(ai: Record<string, unknown>): IntakeFiduciaryFlatFields {
  return {
    trustee_primary: (ai.trustee_primary as string) || null,
    trustee_alternate: (ai.trustee_alternate as string) || null,
    executor_primary: (ai.executor_primary as string) || null,
    executor_alternate: (ai.executor_alternate as string) || null,
    poa_primary: (ai.poa_primary as string) || null,
    poa_alternate: (ai.poa_alternate as string) || null,
    hcp_primary: (ai.hcp_primary as string) || null,
    hcp_alternate: (ai.hcp_alternate as string) || null,
    guardian_primary: (ai.guardian_primary as string) || null,
    guardian_alternate: (ai.guardian_alternate as string) || null,
  }
}

function contactName(contact: ContactWithRoles): string | null {
  const name = joinFiduciaryName(contact.first_name, contact.last_name)
  return name || null
}

function findRoleName(
  contacts: ContactWithRoles[],
  role: string,
  forParty: 'client' | 'spouse',
  priority: number,
): string | null {
  for (const contact of contacts) {
    for (const r of contact.contact_roles) {
      const normalizedRole = r.role === 'executor' ? 'personal_rep' : r.role
      if (
        normalizedRole === role &&
        r.for_party === forParty &&
        !r.is_coagent &&
        (r.priority ?? 1) === priority
      ) {
        return contactName(contact)
      }
    }
  }
  return null
}

/** @internal Exported for unit tests. */
export function buildFiduciarySlotsFromContacts(contacts: ContactWithRoles[]): Partial<Record<IntakeFiduciarySlotKey, FiduciarySlot[]>> {
  const buckets = new Map<IntakeFiduciarySlotKey, Array<{ order: number; is_co: boolean; contact_id: string }>>()

  for (const contact of contacts) {
    for (const role of contact.contact_roles) {
      const contactRole = role.role === 'executor' ? 'personal_rep' : role.role
      if (contactRole !== 'trustee' && contactRole !== 'personal_rep' && contactRole !== 'poa' &&
          contactRole !== 'hcp' && contactRole !== 'guardian') {
        continue
      }
      const forParty = role.for_party === 'spouse' ? 'spouse' : 'client'
      const slotKey = designSlotKeyForContactRole(
        contactRole as 'trustee' | 'personal_rep' | 'poa' | 'hcp' | 'guardian',
        forParty,
      ) as IntakeFiduciarySlotKey | null
      if (!slotKey || !SLOT_KEYS.includes(slotKey)) continue

      const order = Math.max(0, (role.priority ?? 1) - 1)
      const list = buckets.get(slotKey) ?? []
      list.push({
        order,
        is_co: Boolean(role.is_coagent),
        contact_id: contact.id,
      })
      buckets.set(slotKey, list)
    }
  }

  const out: Partial<Record<IntakeFiduciarySlotKey, FiduciarySlot[]>> = {}
  for (const [key, entries] of buckets) {
    entries.sort((a, b) => a.order - b.order || Number(a.is_co) - Number(b.is_co))
    out[key] = entries.map(entry => ({
      id: crypto.randomUUID(),
      contact_id: entry.contact_id,
      is_co: entry.is_co,
      order: entry.order,
    }))
  }
  return out
}

function flatFromContacts(contacts: ContactWithRoles[]): IntakeFiduciaryFlatFields {
  const flat = emptyFlat()
  for (const { role, priority, field } of CLIENT_FLAT_MAP) {
    flat[field] = findRoleName(contacts, role, 'client', priority)
  }
  return flat
}

function mergeFlat(primary: IntakeFiduciaryFlatFields, fallback: IntakeFiduciaryFlatFields): IntakeFiduciaryFlatFields {
  const out = { ...primary }
  for (const key of Object.keys(out) as Array<keyof IntakeFiduciaryFlatFields>) {
    if (!out[key]) out[key] = fallback[key]
  }
  return out
}

/**
 * Load fiduciary flat names and slot arrays from contact_roles (portal path)
 * with column fallback, read through `matter_contacts` (step 3 of
 * docs/matter-contacts-migration.md) so a second engagement reads its own
 * appointments rather than the household's pooled ones.
 */
export async function loadIntakeFiduciarySnapshot(
  admin: AdminClient,
  matterId: string,
  intakeColumns: Record<string, unknown> = {},
): Promise<IntakeFiduciarySnapshot> {
  const { data: joinRows, error } = await admin
    .from('matter_contacts')
    .select('contact_id')
    .eq('matter_id', matterId)
  if (error) throw new Error(error.message)

  const contactIds = ((joinRows ?? []) as Array<{ contact_id: string }>).map(row => row.contact_id)

  const { data, error: contactsError } = contactIds.length
    ? await admin
        .from('contacts')
        .select('id, first_name, last_name, contact_roles(role, for_party, priority, is_coagent, matter_id)')
        .in('id', contactIds)
    : { data: [], error: null }
  if (contactsError) throw new Error(contactsError.message)

  const contacts = ((data ?? []) as unknown as ContactWithRoles[])
    // A person on two matters carries both matters' appointments; keep only
    // the ones this matter records.
    .map(c => ({
      ...c,
      contact_roles: (c.contact_roles ?? []).filter(
        role => (role as { matter_id?: string | null }).matter_id === matterId,
      ),
    }))
  const hasRoles = contacts.some(c => (c.contact_roles?.length ?? 0) > 0)
  const columnFlat = flatFromIntakeColumns(intakeColumns)
  const flat = hasRoles ? mergeFlat(flatFromContacts(contacts), columnFlat) : columnFlat
  const slots = hasRoles ? buildFiduciarySlotsFromContacts(contacts) : {}

  return {
    ...flat,
    trustee_slots: slots.trustee_slots ?? null,
    executor_slots: slots.executor_slots ?? null,
    poa_slots: slots.poa_slots ?? null,
    hcp_slots: slots.hcp_slots ?? null,
    guardian_slots: slots.guardian_slots ?? null,
    spouse_trustee_slots: slots.spouse_trustee_slots ?? null,
    spouse_executor_slots: slots.spouse_executor_slots ?? null,
    spouse_poa_slots: slots.spouse_poa_slots ?? null,
    spouse_hcp_slots: slots.spouse_hcp_slots ?? null,
  }
}
