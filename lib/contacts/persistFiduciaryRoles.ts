import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import type { FiduciaryRoleEntry } from './fiduciaryEntriesToRoles'

// Re-export so admin and other callers can import the entry type from the
// writer module without reaching into the mapper file.
export type { FiduciaryRoleEntry } from './fiduciaryEntriesToRoles'

type AdminClient = SupabaseClient<Database>

// Roles + priorities the F1 writer manages. Mirrors
// lib/adminIntakeFiduciaries.ts:ADMIN_FIDUCIARY_ROLES / ADMIN_FIDUCIARY_PRIORITIES
// so admin and client portal both wipe the same scope.
const MANAGED_ROLES = ['personal_rep', 'trustee', 'poa', 'hcp', 'guardian'] as const
const MANAGED_PRIORITIES = [1, 2] as const

function nameKey(first: unknown, last: unknown): string {
  return `${String(first ?? '').trim().toLowerCase()}|${String(last ?? '').trim().toLowerCase()}`
}

/**
 * Single writer: materialize fiduciary entries into contacts + contact_roles
 * for a client_intake. Mirrors persistAdminFiduciaries
 * (app/actions/adminIntake.ts:176-252) — F2 will dedup the two writers.
 *
 * Wipe-and-recreate scope:
 *   • role IN (personal_rep, trustee, poa, hcp, guardian)
 *   • priority IN (1, 2)
 *   • is_coagent = false
 *   • for_party IN (client, spouse)  — both parties' principals
 *
 * Co-agents (is_coagent=true) and roles outside the managed set are LEFT
 * UNTOUCHED. Existing contact rows are reused by case-insensitive
 * (first_name, last_name) match; fill-mode updates never overwrite a
 * non-null email/phone.
 */
export async function persistFiduciaryRoles(
  admin: AdminClient,
  intakeId: string,
  entries: FiduciaryRoleEntry[],
): Promise<{ contactIds: string[] }> {
  // Step 1: wipe managed contact_roles for this intake.
  const { error: deleteError } = await admin
    .from('contact_roles')
    .delete()
    .eq('client_intake_id', intakeId)
    .eq('is_coagent', false)
    .in('role', MANAGED_ROLES as unknown as string[])
    .in('priority', MANAGED_PRIORITIES as unknown as number[])
  if (deleteError) throw new Error(`${deleteError.code ?? 'error'}: ${deleteError.message}`)

  if (entries.length === 0) return { contactIds: [] }

  // Step 2: read existing contacts so we can reuse by (first, last).
  const { data: existing } = await admin
    .from('contacts')
    .select('id, first_name, last_name, email, phone, preferred_pronoun')
    .eq('client_intake_id', intakeId)

  const byName = new Map<
    string,
    { id: string; email: string | null; phone: string | null; preferred_pronoun: string | null }
  >()
  for (const c of (existing ?? []) as Array<{
    id: string
    first_name: string | null
    last_name: string | null
    email: string | null
    phone: string | null
    preferred_pronoun: string | null
  }>) {
    byName.set(nameKey(c.first_name, c.last_name), {
      id: c.id,
      email: c.email,
      phone: c.phone,
      preferred_pronoun: c.preferred_pronoun,
    })
  }

  // Step 3: for each entry — find or create the contact, fill-mode-update
  // missing email/phone, collect the contact id for the role insert.
  const contactIds = new Map<string, string>()  // entry key -> contact_id
  for (const e of entries) {
    const key = nameKey(e.first_name, e.last_name)
    const found = byName.get(key)
    if (found) {
      contactIds.set(key, found.id)
      // Fill mode: only overwrite NULL/empty fields.
      const patch: Record<string, unknown> = {}
      if (!found.email && e.email) patch.email = e.email
      if (!found.phone && e.phone) patch.phone = e.phone
      // Pronouns are editable on the intake forms, so a supplied value wins
      // over what is stored — but an omitted one never clears the record.
      if (e.preferred_pronoun && e.preferred_pronoun !== found.preferred_pronoun) {
        patch.preferred_pronoun = e.preferred_pronoun
      }
      if (Object.keys(patch).length > 0) {
        const { error: updateError } = await admin
          .from('contacts')
          .update(patch)
          .eq('id', found.id)
        if (updateError) throw new Error(`${updateError.code ?? 'error'}: ${updateError.message}`)
      }
    } else {
      const insertPayload: Record<string, unknown> = {
        client_intake_id: intakeId,
        relationship_type: 'other',
        first_name: e.first_name,
        last_name: e.last_name,
        source: 'client',
      }
      if (e.middle_name) insertPayload.middle_name = e.middle_name
      if (e.email) insertPayload.email = e.email
      if (e.phone) insertPayload.phone = e.phone
      if (e.preferred_pronoun) insertPayload.preferred_pronoun = e.preferred_pronoun
      if (e.relationship_label) insertPayload.relationship_label = e.relationship_label
      const { data: created, error: insertError } = await admin
        .from('contacts')
        .insert(insertPayload)
        .select('id')
        .single()
      if (insertError) throw new Error(`${insertError.code ?? 'error'}: ${insertError.message}`)
      if ((created as { id?: string })?.id) {
        contactIds.set(key, (created as { id: string }).id)
        byName.set(key, {
          id: (created as { id: string }).id,
          email: e.email ?? null,
          phone: e.phone ?? null,
          preferred_pronoun: e.preferred_pronoun ?? null,
        })
      }
    }
  }

  // Step 4: insert contact_roles for every entry that has a contact id.
  const roleRows = entries
    .map((e) => {
      const contactId = contactIds.get(nameKey(e.first_name, e.last_name))
      if (!contactId) return null
      return {
        client_intake_id: intakeId,
        contact_id: contactId,
        role: e.role,
        for_party: e.for_party,
        priority: e.priority,
        is_coagent: e.is_coagent,
      }
    })
    .filter(Boolean) as Array<Record<string, unknown>>

  if (roleRows.length > 0) {
    const { error: roleError } = await admin.from('contact_roles').insert(roleRows)
    if (roleError) throw new Error(`${roleError.code ?? 'error'}: ${roleError.message}`)
  }

  return { contactIds: Array.from(contactIds.values()) }
}
