import type { SupabaseClient } from '@supabase/supabase-js'
import type { GeneratedDatabase } from '@/types/supabase'
import { FIDUCIARY_ROLES, type Appointment, type FiduciaryRole, type ForParty } from './matrix'

/**
 * Which appointment rows belong to a matter.
 *
 * `contact_roles` carries both a `matter_id` and a `client_intake_id`. The
 * intake captures who the client named before a matter existed; the matter
 * refines it afterwards. So a matter's own rows win outright when it has any,
 * and the intake's answer is the fallback — otherwise a later change would be
 * shown alongside the older answer it replaced, and the screen would name two
 * different people for one office.
 */
export function selectAppointmentRows<T extends { matter_id?: unknown; client_intake_id?: unknown }>(
  rows: readonly T[],
  matterId: string,
  intakeId: string,
): T[] {
  const forMatter = rows.filter((row) => String(row.matter_id ?? '') === matterId)
  if (forMatter.length > 0) return forMatter
  return rows.filter((row) => String(row.client_intake_id ?? '') === intakeId)
}

export interface MatterFiduciaries {
  matterId: string
  title: string
  appointments: Appointment[]
  minorChildren: number
}

const isRole = (value: string): value is FiduciaryRole =>
  (FIDUCIARY_ROLES as readonly string[]).includes(value)

/**
 * Exported so a second caller with its own reason to turn a `contacts` row
 * into a display name (see `designSheet.ts`'s `*_slots` resolution) reuses
 * this rather than writing a second version of the same three-field join.
 */
export const fullName = (contact: Record<string, unknown>): string =>
  [contact.first_name, contact.middle_name, contact.last_name]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' ') || 'Unnamed contact'

/**
 * Appointments for hired matters, with the names attached.
 *
 * `contact_roles` carries both a `matter_id` and a `client_intake_id`, and rows
 * exist under each — the intake captures who the client named before a matter
 * exists, and the matter refines it. Both are read and the matter's own rows
 * win, so a later change is never hidden behind an older intake answer.
 */
export async function loadFiduciaries(
  client: SupabaseClient<GeneratedDatabase>,
  options: { matterId?: string } = {},
): Promise<MatterFiduciaries[]> {
  const sb = client

  let matterQuery = sb
    .from('matters')
    .select('id, name, client_intake_id')
    .eq('relationship_status', 'hired')
  if (options.matterId) matterQuery = matterQuery.eq('id', options.matterId)

  const { data: matters, error: matterError } = await matterQuery
  if (matterError) throw new Error(`Could not load matters: ${matterError.message}`)
  if (!matters || matters.length === 0) return []

  const matterIds = matters.map((m) => String(m.id))
  const intakeIds = [...new Set(matters.map((m) => String(m.client_intake_id)))]

  const [{ data: roles, error: roleError }, { data: minors, error: minorError }] = await Promise.all([
    sb
      .from('contact_roles')
      .select('contact_id, role, for_party, priority, is_coagent, matter_id, client_intake_id')
      .or(`matter_id.in.(${matterIds.join(',')}),client_intake_id.in.(${intakeIds.join(',')})`),
    sb.from('matter_contacts').select('matter_id, is_minor').in('matter_id', matterIds),
  ])

  if (roleError) throw new Error(`Could not load appointments: ${roleError.message}`)
  if (minorError) throw new Error(`Could not load household: ${minorError.message}`)

  const contactIds = [...new Set((roles ?? []).map((r) => String(r.contact_id)))]
  const { data: contacts, error: contactError } = contactIds.length
    ? await sb.from('contacts').select('id, first_name, middle_name, last_name').in('id', contactIds)
    : { data: [], error: null }
  if (contactError) throw new Error(`Could not load contacts: ${contactError.message}`)

  const nameById = new Map((contacts ?? []).map((c) => [String(c.id), fullName(c)]))

  return matters.map((matter) => {
    const matterId = String(matter.id)
    const intakeId = String(matter.client_intake_id)
    const rows = selectAppointmentRows(roles ?? [], matterId, intakeId)

    return {
      matterId,
      title: (matter.name as string | null) ?? 'Untitled matter',
      appointments: rows
        .filter((row) => isRole(String(row.role)))
        .map((row) => ({
          contactId: String(row.contact_id),
          name: nameById.get(String(row.contact_id)) ?? 'Unnamed contact',
          role: String(row.role) as FiduciaryRole,
          forParty: (String(row.for_party) === 'spouse' ? 'spouse' : 'client') as ForParty,
          priority: Number(row.priority ?? 1),
          isCoagent: Boolean(row.is_coagent),
        })),
      minorChildren: (minors ?? []).filter(
        (m) => String(m.matter_id) === matterId && m.is_minor === true,
      ).length,
    }
  })
}
