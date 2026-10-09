import { getAdminClient } from '@/lib/supabaseAdmin'
import { hydrateIntakeWithContacts } from '@/lib/intakeContactHydration'

/**
 * Load one `client_intake` row with everything the attorney intake form needs
 * to reconstruct itself: the household contacts (spouse + children), the
 * fiduciary roles, and the contact picklist.
 *
 * Extracted from `getAdminIntakeData` so the Word export route reads the exact
 * same shape the sheet does — the export must not drift from the form.
 * Callers are responsible for their own authorization: this uses the
 * service-role client and bypasses RLS.
 */
export async function loadAdminIntakeRow(
  clientIntakeId: string,
): Promise<Record<string, unknown> | null> {
  const admin = getAdminClient()
  const { data, error } = await admin
    .from('client_intake')
    .select('*')
    .eq('id', clientIntakeId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null

  // Fiduciary roles (joined to contacts) so the sheet can reconstruct its flat
  // trustee/executor/POA/HCP/guardian fields. These live in contact_roles, not
  // on client_intake.
  //
  // Also attach all contacts for the intake as _intake_contacts — the F3
  // picklist UI sources its suggestions from this list. Includes
  // lead-detail-imported contacts that don't yet have a contact_roles entry.
  // Appointments are matter-scoped since step 3 of
  // docs/matter-contacts-migration.md, and persistAdminFiduciaries writes them
  // that way. Reading them by intake instead would show this form a second
  // engagement's fiduciaries while a save only rewrites this matter's.
  const { data: matterRow } = await admin
    .from('matters')
    .select('id')
    .eq('client_intake_id', clientIntakeId)
    .maybeSingle()
  const formMatterId = (matterRow?.id as string | undefined) ?? null

  const [{ data: roleRows }, { data: contactRows }] = await Promise.all([
    formMatterId
      ? admin
          .from('contact_roles')
          .select('role, for_party, priority, is_coagent, contacts(first_name, last_name, preferred_pronoun)')
          .eq('matter_id', formMatterId)
          .eq('for_party', 'client')
      : Promise.resolve({ data: [] }),
    admin
      .from('contacts')
      .select('id, first_name, last_name, relationship_label')
      .eq('client_intake_id', clientIntakeId)
      .order('first_name', { ascending: true })
      .order('last_name', { ascending: true }),
  ])

  const fiduciaryRoles = ((roleRows ?? []) as Array<Record<string, unknown>>).map((r) => {
    const contact = (r.contacts ?? null) as {
      first_name?: string | null
      last_name?: string | null
      preferred_pronoun?: string | null
    } | null
    return {
      role: r.role,
      for_party: r.for_party,
      priority: r.priority,
      is_coagent: r.is_coagent,
      first_name: contact?.first_name ?? null,
      last_name: contact?.last_name ?? null,
      preferred_pronoun: contact?.preferred_pronoun ?? null,
    }
  })

  const intakeContacts = ((contactRows ?? []) as Array<{
    id: string
    first_name: string | null
    last_name: string | null
    relationship_label: string | null
  }>).map((c) => ({
    id: c.id,
    first_name: c.first_name,
    last_name: c.last_name,
    relationship_label: c.relationship_label,
  }))

  const hydrated = await hydrateIntakeWithContacts(admin, {
    ...data,
    _fiduciary_roles: fiduciaryRoles,
    _intake_contacts: intakeContacts,
  }, clientIntakeId, true)
  return hydrated
}
