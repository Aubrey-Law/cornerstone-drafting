import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import type { FiduciaryForParty, FiduciaryRoleEntry } from './fiduciaryEntriesToRoles'
import { attachContactToMatter } from './attachContactToMatter'

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
 *   • for_party IN `options.parties` (default: client + spouse)
 *
 * A caller that only carries one party's entries — the admin sheet only
 * captures client-party fiduciaries — must narrow `parties` so the other
 * party's rows survive the wipe.
 *
 * Co-agents (is_coagent=true) and roles outside the managed set are LEFT
 * UNTOUCHED. Existing contact rows are reused by scoped contact_id, or by
 * case-insensitive (first_name, last_name) for legacy id-less entries;
 * fill-mode updates never overwrite a
 * non-null email/phone.
 */
export async function persistFiduciaryRoles(
  admin: AdminClient,
  matterId: string,
  entries: FiduciaryRoleEntry[],
  options?: { parties?: FiduciaryForParty[] },
): Promise<{ contactIds: string[] }> {
  const parties: FiduciaryForParty[] = options?.parties ?? ['client', 'spouse']

  // Contacts are still written with the legacy household FK — step 3 makes it
  // write-only, and the step 2 triggers build the join from it. matter → intake
  // is a single FK, so unlike the reverse it can never be ambiguous.
  const { data: matterRow, error: matterError } = await admin
    .from('matters')
    .select('client_intake_id')
    .eq('id', matterId)
    .maybeSingle()
  if (matterError) throw new Error(`${matterError.code ?? 'error'}: ${matterError.message}`)
  const intakeId = (matterRow as { client_intake_id?: string | null } | null)?.client_intake_id ?? null

  // Read the people already on this matter for identity authorization and
  // legacy name matching rather than minting another copy of a fiduciary.
  const { data: existingJoins, error: joinsError } = await admin
    .from('matter_contacts')
    .select('contact_id')
    .eq('matter_id', matterId)
  if (joinsError) throw new Error(joinsError.message)

  const existingIds = ((existingJoins ?? []) as Array<{ contact_id: string }>).map(r => r.contact_id)
  const { data: existing, error: contactsError } = existingIds.length
    ? await admin
        .from('contacts')
        .select('id, first_name, last_name, email, phone, preferred_pronoun')
        .in('id', existingIds)
    : { data: [], error: null }
  if (contactsError) throw new Error(contactsError.message)

  const byName = new Map<
    string,
    { id: string; email: string | null; phone: string | null; preferred_pronoun: string | null }
  >()
  const byId = new Map<string, { id: string; email: string | null; phone: string | null; preferred_pronoun: string | null }>()
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
    byId.set(c.id, c)
  }

  // Identity is authoritative only after it is authorized through this
  // matter's contact join. Validate all supplied IDs before any mutation,
  // especially before replacing roles. Stale copied names never rename or
  // clone a person whose scoped identity is known.
  for (const entry of entries) {
    if (entry.contact_id && !byId.has(entry.contact_id)) {
      throw new Error('Fiduciary contact does not belong to this matter')
    }
  }

  // For each entry — find or create the contact, fill-mode-update
  // missing email/phone, collect the contact id for the role insert.
  const contactIds = new Map<FiduciaryRoleEntry, string>()
  for (const e of entries) {
    const key = nameKey(e.first_name, e.last_name)
    const found = e.contact_id ? byId.get(e.contact_id) : byName.get(key)
    if (found) {
      contactIds.set(e, found.id)
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
        // Step 7a: a fiduciary created here goes onto the matter directly.
        await attachContactToMatter(admin, matterId, (created as { id: string }).id, {
          relationship_type: 'other',
          relationship_label: e.relationship_label ?? null,
          for_party: e.for_party,
        })
        contactIds.set(e, (created as { id: string }).id)
        byName.set(key, {
          id: (created as { id: string }).id,
          email: e.email ?? null,
          phone: e.phone ?? null,
          preferred_pronoun: e.preferred_pronoun ?? null,
        })
      }
    }
  }

  // Wipe only after contact resolution succeeds, scoped to this matter.
  const { error: deleteError } = await admin
    .from('contact_roles')
    .delete()
    .eq('matter_id', matterId)
    .eq('is_coagent', false)
    .in('role', MANAGED_ROLES as unknown as string[])
    .in('priority', MANAGED_PRIORITIES as unknown as number[])
    .in('for_party', parties)
  if (deleteError) throw new Error(`${deleteError.code ?? 'error'}: ${deleteError.message}`)

  // Insert contact_roles for every entry that has a contact id.
  const roleRows = entries
    .map((e) => {
      const contactId = contactIds.get(e)
      if (!contactId) return null
      return {
        matter_id: matterId,
        // Dual-written until step 7 drops the column. Set explicitly rather
        // than left to sync_contact_role_matter, which declines to guess once
        // an intake carries two matters.
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
