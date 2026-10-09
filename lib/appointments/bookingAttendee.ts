import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { loadSpouseContact } from '@/lib/contacts/loadSpouseContact'
import { splitDisplayName } from '@/lib/appointments/types'

type AdminClient = SupabaseClient<Database>

/** Who to book for, with names as stored components, for staff booking forms. */
export interface BookingAttendee {
  firstName: string
  lastName: string
  email: string
  phone: string
  secondFirstName: string
  secondLastName: string
  secondEmail: string
}

interface NameRow {
  first_name?: string | null
  last_name?: string | null
  full_name?: string | null
  email?: string | null
  phone?: string | null
}

/** Stored first/last when present; otherwise a split of the display name. */
function names(row: NameRow | null): { firstName: string; lastName: string } {
  const first = row?.first_name?.trim() ?? ''
  const last = row?.last_name?.trim() ?? ''
  if (first && last) return { firstName: first, lastName: last }
  const display = row?.full_name?.trim() || [first, last].filter(Boolean).join(' ')
  return splitDisplayName(display)
}

/**
 * The client and spouse of a lead or matter, read from the intake and the
 * spouse contact rather than the pipeline view's combined display names.
 * Returns null when the record does not exist.
 */
export async function loadBookingAttendee(
  admin: AdminClient,
  target: { leadId: string } | { matterId: string },
): Promise<BookingAttendee | null> {
  let intakeId: string
  if ('matterId' in target) {
    const { data, error } = await admin
      .from('matters')
      .select('client_intake_id')
      .eq('id', target.matterId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data?.client_intake_id) return null
    intakeId = data.client_intake_id
  } else {
    intakeId = target.leadId
  }

  const { data: intake, error: intakeError } = await admin
    .from('client_intake')
    .select('first_name, last_name, full_name, email, phone')
    .eq('id', intakeId)
    .maybeSingle()
  if (intakeError) throw new Error(intakeError.message)
  if (!intake) return null

  let spouse: NameRow | null
  if ('matterId' in target) {
    spouse = await loadSpouseContact(admin, target.matterId, 'first_name, last_name, email')
  } else {
    const { data, error } = await admin
      .from('contacts')
      .select('first_name, last_name, email')
      .eq('client_intake_id', intakeId)
      .eq('relationship_type', 'spouse')
      .maybeSingle()
    if (error) throw new Error(error.message)
    spouse = data
  }

  const client = names(intake)
  const second = spouse ? names(spouse) : { firstName: '', lastName: '' }
  return {
    firstName: client.firstName,
    lastName: client.lastName,
    email: intake.email?.trim() ?? '',
    phone: intake.phone?.trim() ?? '',
    secondFirstName: second.firstName,
    secondLastName: second.lastName,
    secondEmail: spouse?.email?.trim() ?? '',
  }
}
