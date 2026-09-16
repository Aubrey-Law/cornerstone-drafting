import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getAdminClient } from '@/lib/supabaseAdmin'
import type { GeneratedDatabase } from '@/types/supabase'
import { IntegrationError } from '@/lib/integrations/errors'
import type { StatularAddress, StatularChild, StatularClientPayload, StatularGender } from './types'

type IntakeRow = GeneratedDatabase['public']['Tables']['client_intake']['Row']
type ContactRow = GeneratedDatabase['public']['Tables']['contacts']['Row']
type MatterContactRow = GeneratedDatabase['public']['Tables']['matter_contacts']['Row']

function database(): SupabaseClient<GeneratedDatabase> {
  return getAdminClient() as unknown as SupabaseClient<GeneratedDatabase>
}

function failure(code: string, safeMessage: string, kind: 'attention' | 'retryable' = 'attention') {
  return new IntegrationError({ provider: 'statular', kind, code, safeMessage, retryAfterMs: null })
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function requiredName(value: unknown): string | null {
  return text(value) ?? null
}

function calendarDate(value: unknown): string | undefined {
  const source = text(value)
  if (!source) return undefined
  const match = /^(\d{4})-(\d{2})-(\d{2})(T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(source)
  if (!match || match[1] === '0000') throw failure('invalid_source_data', 'The client record contains an invalid date.')
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const normalized = `${match[1]}-${match[2]}-${match[3]}`
  const date = new Date(Date.UTC(year, month - 1, day))
  if ((match[4] && !Number.isFinite(Date.parse(source)))
    || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw failure('invalid_source_data', 'The client record contains an invalid date.')
  }
  return normalized
}

function gender(value: unknown): StatularGender | undefined {
  const normalized = text(value)?.toLowerCase()
  if (!normalized) return undefined
  if (normalized === 'male' || normalized === 'female' || normalized === 'nonbinary') return normalized
  throw failure('invalid_source_data', 'The client record contains an unsupported gender value.')
}

function address(row: {
  address_line1?: unknown
  address_line2?: unknown
  city?: unknown
  county?: unknown
  state?: unknown
  zip?: unknown
}): StatularAddress | undefined {
  const result: StatularAddress = {
    ...(text(row.address_line1) ? { streetAddress1: text(row.address_line1) } : {}),
    ...(text(row.address_line2) ? { streetAddress2: text(row.address_line2) } : {}),
    ...(text(row.city) ? { city: text(row.city) } : {}),
    ...(text(row.county) ? { county: text(row.county) } : {}),
    ...(text(row.state) ? { state: text(row.state) } : {}),
    ...(text(row.zip) ? { zip: text(row.zip) } : {}),
  }
  return Object.keys(result).length ? result : undefined
}

function childRelationship(value: unknown): StatularChild['relationship'] {
  switch (text(value)?.toLowerCase()) {
    case 'joint': return 'joint'
    case 'client': return 'settlor1'
    case 'spouse': return 'settlor2'
    default: throw failure('invalid_source_data', 'A child record needs an explicit parentage selection.')
  }
}

function child(contact: ContactRow): StatularChild {
  // Contacts carry structured names. Joining them for Statular's single child
  // name field is deterministic and never attempts to split a display name.
  const name = [text(contact.first_name), text(contact.middle_name), text(contact.last_name)].filter(Boolean).join(' ')
  if (!name) throw failure('invalid_source_data', 'A child record needs an explicit name.')
  const childAddress = address(contact)
  const childGender = gender(contact.gender)
  const birthdate = calendarDate(contact.date_of_birth)
  return {
    name,
    relationship: childRelationship(contact.parentage),
    ...(childGender ? { gender: childGender } : {}),
    ...(birthdate ? { birthdate } : {}),
    ...(text(contact.phone) ? { phone: text(contact.phone) } : {}),
    ...(text(contact.email) ? { email: text(contact.email) } : {}),
    ...(childAddress ? { address: childAddress } : {}),
    ...(typeof contact.deceased === 'boolean' ? { deceased: contact.deceased } : {}),
  }
}

function partnerFromContact(contact: ContactRow): Partial<StatularClientPayload> {
  const firstName = requiredName(contact.first_name)
  const lastName = requiredName(contact.last_name)
  if (!firstName || !lastName) {
    throw failure('invalid_source_data', 'The spouse contact needs explicit first and last names.')
  }
  const partnerAddress = address(contact)
  const partnerGender = gender(contact.gender)
  const dob = calendarDate(contact.date_of_birth)
  return {
    partner: true,
    partner_first_name: firstName,
    ...(text(contact.middle_name) ? { partner_middle_name: text(contact.middle_name) } : {}),
    partner_last_name: lastName,
    ...(text(contact.email) ? { partner_email: text(contact.email) } : {}),
    ...(text(contact.phone) ? { partner_phone: text(contact.phone) } : {}),
    ...(dob ? { partner_dob: dob } : {}),
    ...(partnerGender ? { partner_gender: partnerGender } : {}),
    ...(partnerAddress ? { partner_address: partnerAddress } : {}),
  }
}

async function appointmentPartner(clientIntakeId: string): Promise<Partial<StatularClientPayload>> {
  const { data, error } = await database().from('appointments')
    .select('second_attendee_first_name, second_attendee_last_name, second_attendee_email, second_attendee_name, created_at')
    .eq('linked_lead_id', clientIntakeId)
    .eq('status', 'scheduled')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw failure('source_unavailable', 'The linked appointment could not be read.', 'retryable')
  if (!data) return {}
  const firstName = text(data.second_attendee_first_name)
  const lastName = text(data.second_attendee_last_name)
  const hasEvidence = Boolean(firstName || lastName || text(data.second_attendee_email) || text(data.second_attendee_name))
  if (!hasEvidence) return {}
  if (!firstName || !lastName) {
    throw failure('invalid_source_data', 'The linked appointment needs explicit spouse first and last names.')
  }
  return {
    partner: true,
    partner_first_name: firstName,
    partner_last_name: lastName,
    ...(text(data.second_attendee_email) ? { partner_email: text(data.second_attendee_email) } : {}),
  }
}

const CONTACT_FIELDS = 'id, client_intake_id, relationship_type, first_name, middle_name, last_name, email, phone, date_of_birth, gender, address_line1, address_line2, city, county, state, zip, parentage, deceased, created_at'

async function householdContacts(
  admin: SupabaseClient<GeneratedDatabase>,
  clientIntakeId: string,
): Promise<ContactRow[]> {
  const { data: matter, error: matterError } = await admin.from('matters')
    .select('id')
    .eq('client_intake_id', clientIntakeId)
    .maybeSingle()
  if (matterError) throw failure('source_unavailable', 'The linked matter could not be read.', 'retryable')

  if (!matter) {
    const { data, error } = await admin.from('contacts')
      .select(CONTACT_FIELDS)
      .eq('client_intake_id', clientIntakeId)
      .in('relationship_type', ['spouse', 'child'])
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
    if (error) throw failure('source_unavailable', 'The household contacts could not be read.', 'retryable')
    return (data ?? []) as ContactRow[]
  }

  const { data: membershipRows, error: membershipError } = await admin.from('matter_contacts')
    .select('contact_id, relationship_type, parentage')
    .eq('matter_id', matter.id)
    .in('relationship_type', ['spouse', 'child'])
  if (membershipError) throw failure('source_unavailable', 'The matter household could not be read.', 'retryable')
  const memberships = (membershipRows ?? []) as MatterContactRow[]
  if (!memberships.length) return []

  const { data: contactRows, error: contactsError } = await admin.from('contacts')
    .select(CONTACT_FIELDS)
    .in('id', memberships.map(row => row.contact_id))
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
  if (contactsError) throw failure('source_unavailable', 'The household contacts could not be read.', 'retryable')
  const membershipByContact = new Map(memberships.map(row => [row.contact_id, row]))
  return ((contactRows ?? []) as ContactRow[]).map(contact => {
    const membership = membershipByContact.get(contact.id)
    if (!membership) throw failure('invalid_source_data', 'The matter household contains an invalid contact reference.')
    return {
      ...contact,
      relationship_type: membership.relationship_type,
      parentage: membership.parentage,
    }
  })
}

/** Builds the allow-listed client webhook body from service-role source reads. */
export async function buildStatularClientPayload(clientIntakeId: string): Promise<StatularClientPayload> {
  const admin = database()
  const { data: intake, error } = await admin.from('client_intake')
    .select('id, first_name, middle_name, last_name, email, phone, date_of_birth, marital_status, address_line1, address_line2, city, county, state, zip')
    .eq('id', clientIntakeId)
    .maybeSingle()
  if (error) throw failure('source_unavailable', 'The client intake could not be read.', 'retryable')
  if (!intake) throw failure('identity_required', 'The client intake could not be found.')

  const firstName = requiredName(intake.first_name)
  const lastName = requiredName(intake.last_name)
  if (!firstName || !lastName) throw failure('identity_required', 'The client intake needs explicit first and last names.')

  const contacts = await householdContacts(admin, clientIntakeId)
  const spouse = contacts.find(contact => contact.relationship_type === 'spouse')
  const children = contacts.filter(contact => contact.relationship_type === 'child').map(child)
  const intakeAddress = address(intake as IntakeRow)
  const dob = calendarDate(intake.date_of_birth)
  const partner = spouse ? partnerFromContact(spouse) : await appointmentPartner(clientIntakeId)

  return {
    first_name: firstName,
    last_name: lastName,
    ...(text(intake.middle_name) ? { middle_name: text(intake.middle_name) } : {}),
    ...(text(intake.email) ? { email: text(intake.email) } : {}),
    ...(text(intake.phone) ? { phone: text(intake.phone) } : {}),
    ...(dob ? { dob } : {}),
    ...(text(intake.marital_status) ? { marital_status: text(intake.marital_status) } : {}),
    ...(intakeAddress ? { address: intakeAddress } : {}),
    ...partner,
    ...(children.length ? { children } : {}),
  }
}
