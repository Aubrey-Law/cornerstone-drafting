import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'

type AdminClient = SupabaseClient<Database>

export interface MatterContactFacts {
  relationship_type: string
  relationship_label?: string | null
  for_party?: string | null
  child_relationship?: string | null
  parentage?: string | null
  from_prior_relationship?: boolean | null
  is_minor?: boolean | null
}

/**
 * Put a person on a matter.
 *
 * Step 7a of docs/matter-contacts-migration.md: every writer that creates a
 * contact now writes its join row itself, rather than setting
 * `contacts.client_intake_id` and leaving `sync_matter_contacts_from_contact`
 * to infer it. That trigger is what step 7b removes along with the column, and
 * until a writer does this for itself, removing it would make the contacts it
 * creates invisible — every reader has gone through the join since step 3.
 *
 * Idempotent, and safe to call alongside the trigger while both exist: the
 * conflict target is the join's own unique key, and re-running updates the
 * matter-relative facts rather than duplicating the row.
 *
 * Resolving a matter is the caller's job. A contact that genuinely belongs to
 * no matter — a referring CPA in the directory — simply never calls this.
 */
export async function attachContactToMatter(
  admin: AdminClient,
  matterId: string | null | undefined,
  contactId: string,
  facts: MatterContactFacts,
): Promise<void> {
  if (!matterId) return

  const { error } = await admin
    .from('matter_contacts')
    .upsert(
      {
        matter_id: matterId,
        contact_id: contactId,
        relationship_type: facts.relationship_type,
        relationship_label: facts.relationship_label ?? null,
        for_party: facts.for_party ?? null,
        child_relationship: facts.child_relationship ?? null,
        parentage: facts.parentage ?? null,
        from_prior_relationship: facts.from_prior_relationship ?? null,
        is_minor: facts.is_minor ?? null,
      },
      { onConflict: 'matter_id,contact_id' },
    )

  if (error) throw new Error(`${error.code ?? 'error'}: ${error.message}`)
}

/**
 * The matter a household writer should attach to, given the intake it was
 * handed. Unambiguous because §12.3 settled that each engagement gets its own
 * `client_intake` row, so this stays a single row for good — unlike the
 * reverse-direction lookups §5 warned about.
 */
export async function matterIdForIntake(
  admin: AdminClient,
  intakeId: string | null | undefined,
): Promise<string | null> {
  if (!intakeId) return null
  const { data, error } = await admin
    .from('matters')
    .select('id')
    .eq('client_intake_id', intakeId)
    .maybeSingle()
  if (error) throw new Error(`${error.code ?? 'error'}: ${error.message}`)
  return (data?.id as string | undefined) ?? null
}
