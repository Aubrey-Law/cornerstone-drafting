import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { composedAddressOneLine } from '@/lib/intakeContactAddress'
import { CLIENT_INTAKE_ADDITIONAL_SOURCE } from '@/lib/intakeContactSource'
import { formatPhoneInput } from '@/lib/phone'
import { splitName } from '@/lib/contacts/childName'

type DbClient = SupabaseClient<Database>

type ContactRoleRow = {
  role?: unknown
  for_party?: unknown
  priority?: unknown
  is_coagent?: unknown
}

type ContactRow = Record<string, unknown> & {
  id?: unknown
  contact_roles?: ContactRoleRow[] | null
}

const ROLE_PARTY_TO_SLOT: Record<string, string> = {
  'personal_rep|client': 'fid_personal_rep_client',
  'personal_rep|spouse': 'fid_personal_rep_spouse',
  'trustee|client': 'fid_trustee_client',
  'trustee|spouse': 'fid_trustee_spouse',
  'poa|client': 'fid_poa_client',
  'poa|spouse': 'fid_poa_spouse',
  'hcp|client': 'fid_hcp_client',
  'hcp|spouse': 'fid_hcp_spouse',
  'guardian|client': 'fid_guardian_client',
}

const MAX_FIDUCIARY_PRIORITY = 2

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function phone(value: unknown): string {
  return formatPhoneInput(typeof value === 'string' ? value : '')
}

function requestArray(value: unknown): Record<string, unknown>[] | null {
  return Array.isArray(value) ? value.filter(isRecord) : null
}

function normalizeChildEntry(raw: Record<string, unknown>): Record<string, unknown> {
  const split = splitName(typeof raw.name === 'string' ? raw.name : null)
  const firstName = text(raw.first_name) || split.first
  const lastName = text(raw.last_name) || split.last
  return {
    ...raw,
    first_name: firstName,
    middle_name: raw.middle_name ?? split.middle ?? '',
    last_name: lastName,
    date_of_birth: raw.date_of_birth ?? raw.dob ?? '',
    contact_id: raw.contact_id ?? raw.id ?? null,
  }
}

export function intakeChildrenFromRequestBody(body: Record<string, unknown>): Record<string, unknown>[] | null {
  const direct = requestArray(body.children) ?? requestArray(body._children)
  if (direct) return direct.map(normalizeChildEntry)

  const fiduciaryEntries = isRecord(body.fiduciary_entries) ? body.fiduciary_entries : null
  const nested = fiduciaryEntries ? requestArray(fiduciaryEntries.children) : null
  return nested ? nested.map(normalizeChildEntry) : null
}

export function intakeAdditionalContactsFromRequestBody(body: Record<string, unknown>): Record<string, unknown>[] | null {
  const direct = requestArray(body.additional_contacts) ?? requestArray(body._additional_contacts)
  if (direct) return direct

  const fiduciaryEntries = isRecord(body.fiduciary_entries) ? body.fiduciary_entries : null
  return fiduciaryEntries ? requestArray(fiduciaryEntries.additional_contacts) : null
}

function entryDisplayName(entry: Record<string, unknown>): string {
  const structured = [
    entry.first_name,
    entry.middle_name,
    entry.last_name,
    entry.suffix,
  ].map(text).filter(Boolean).join(' ')
  if (structured) return structured
  return text(entry.name)
}

export function intakeExcludedGuardianTextFromRequestBody(
  body: Record<string, unknown>,
): string | null | undefined {
  if (body.excluded_guardian !== undefined || body.excluded_guardians !== undefined) {
    const direct = text(body.excluded_guardian ?? body.excluded_guardians)
    return direct || null
  }

  const directEntries = requestArray(body._fid_excluded_guardian)
  const fiduciaryEntries = isRecord(body.fiduciary_entries) ? body.fiduciary_entries : null
  const entries = directEntries ?? (fiduciaryEntries ? requestArray(fiduciaryEntries.fid_excluded_guardian) : null)
  if (!entries) return undefined

  const names = entries.map(entryDisplayName).filter(Boolean)
  return names.length > 0 ? names.join('; ') : null
}

export function overlayRequestContactIntakeData(
  intake: Record<string, unknown>,
  body: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...intake }

  const spouseKeys = [
    'spouse_first_name',
    'spouse_middle_name',
    'spouse_last_name',
    'spouse_suffix',
    'spouse_preferred_name',
    'spouse_prior_names',
    'spouse_preferred_pronoun',
    'spouse_date_of_birth',
    'spouse_is_us_citizen',
    'spouse_email',
    'spouse_phone',
  ]
  if (spouseKeys.some((key) => body[key] !== undefined)) {
    const currentSpouse = isRecord(out._spouse) ? out._spouse : {}
    out._spouse = {
      ...currentSpouse,
      first_name: body.spouse_first_name ?? currentSpouse.first_name ?? '',
      middle_name: body.spouse_middle_name ?? currentSpouse.middle_name ?? '',
      last_name: body.spouse_last_name ?? currentSpouse.last_name ?? '',
      suffix: body.spouse_suffix ?? currentSpouse.suffix ?? '',
      preferred_name: body.spouse_preferred_name ?? currentSpouse.preferred_name ?? '',
      prior_names: body.spouse_prior_names ?? currentSpouse.prior_names ?? '',
      preferred_pronoun: body.spouse_preferred_pronoun ?? currentSpouse.preferred_pronoun ?? '',
      date_of_birth: body.spouse_date_of_birth ?? currentSpouse.date_of_birth ?? '',
      is_us_citizen: body.spouse_is_us_citizen ?? currentSpouse.is_us_citizen ?? true,
      email: body.spouse_email ?? currentSpouse.email ?? '',
      phone: body.spouse_phone !== undefined ? phone(body.spouse_phone) : currentSpouse.phone ?? '',
    }
  }

  const children = intakeChildrenFromRequestBody(body)
  if (children) out._children = children

  const additionalContacts = intakeAdditionalContactsFromRequestBody(body)
  if (additionalContacts) out._additional_contacts = additionalContacts

  const excludedGuardian = intakeExcludedGuardianTextFromRequestBody(body)
  if (excludedGuardian !== undefined) out.excluded_guardian = excludedGuardian

  const fiduciaryEntries = isRecord(body.fiduciary_entries) ? body.fiduciary_entries : null
  if (fiduciaryEntries) {
    for (const [key, value] of Object.entries(fiduciaryEntries)) {
      if (key.startsWith('fid_') && Array.isArray(value)) {
        out[`_${key}`] = value.filter(isRecord)
      }
    }
  }

  return out
}

/**
 * The children step's Parent pills use 'both' and the client's / spouse's
 * first names, so hydrate the stored parentage into that same vocabulary.
 */
function parentPillValue(
  parentage: ContactRow['parentage'],
  clientFirstName: string,
  spouseFirstName: string,
): string {
  if (parentage === 'client') return clientFirstName
  if (parentage === 'spouse') return spouseFirstName || 'spouse'
  return 'both'
}

function childContactToIntakeEntry(
  contact: ContactRow,
  clientFirstName: string,
  spouseFirstName: string,
): Record<string, unknown> {
  return {
    id: String(contact.id ?? ''),
    contact_id: String(contact.id ?? ''),
    first_name: text(contact.first_name),
    middle_name: text(contact.middle_name),
    last_name: text(contact.last_name),
    suffix: text(contact.suffix),
    date_of_birth: contact.date_of_birth ?? '',
    pronouns: contact.preferred_pronoun ?? '',
    email: contact.email ?? '',
    phone: phone(contact.phone),
    same_address: false,
    parent: parentPillValue(contact.parentage, clientFirstName, spouseFirstName),
    relationship: contact.child_relationship ?? 'biological',
    parentage: contact.parentage ?? null,
    is_minor: contact.is_minor,
  }
}

function additionalContactToIntakeEntry(contact: ContactRow): Record<string, unknown> {
  const address =
    composedAddressOneLine({
      street: contact.address_line1,
      city: contact.city,
      state: contact.state,
      zip: contact.zip,
    }) ?? ''

  return {
    id: String(contact.id ?? ''),
    first_name: text(contact.first_name),
    middle_name: text(contact.middle_name),
    last_name: text(contact.last_name),
    suffix: text(contact.suffix),
    preferred_pronoun: text(contact.preferred_pronoun),
    email: contact.email ?? '',
    phone: phone(contact.phone),
    relationship: contact.relationship_label ?? '',
    street: contact.address_line1 ?? '',
    city: contact.city ?? '',
    state: contact.state ?? '',
    zip: contact.zip ?? '',
    address,
  }
}

function fiduciaryEntryFromContact(contact: ContactRow): Record<string, unknown> {
  const address =
    composedAddressOneLine({
      street: contact.address_line1,
      city: contact.city,
      state: contact.state,
      zip: contact.zip,
    }) ?? ''

  return {
    contact_id: String(contact.id ?? ''),
    first_name: text(contact.first_name),
    middle_name: text(contact.middle_name),
    last_name: text(contact.last_name),
    suffix: text(contact.suffix),
    relationship: contact.relationship_label ?? contact.relationship_type ?? '',
    preferred_pronoun: text(contact.preferred_pronoun),
    phone: phone(contact.phone),
    email: contact.email ?? '',
    street: contact.address_line1 ?? '',
    city: contact.city ?? '',
    state: contact.state ?? '',
    zip: contact.zip ?? '',
    address,
  }
}

export function applyContactIntakeData(
  intake: Record<string, unknown>,
  contacts: ContactRow[],
): Record<string, unknown> {
  const out = { ...intake }

  const spouse = contacts.find((contact) => contact.relationship_type === 'spouse')
  if (spouse) {
    out._spouse = {
      first_name: text(spouse.first_name),
      middle_name: text(spouse.middle_name),
      last_name: text(spouse.last_name),
      suffix: text(spouse.suffix),
      prior_names: text(spouse.prior_names),
      preferred_name: text(spouse.preferred_name),
      preferred_pronoun: text(spouse.preferred_pronoun),
      date_of_birth: spouse.date_of_birth ?? '',
      is_us_citizen: spouse.is_us_citizen ?? true,
      email: spouse.email ?? '',
      phone: phone(spouse.phone),
    }
  }

  // Matches the fallback label StepChildren renders for an unnamed client.
  const clientFirstName = text(intake.first_name) || 'Client'
  const spouseFirstName = text(spouse?.first_name)
  const children = contacts
    .filter((contact) => contact.relationship_type === 'child')
    .map((contact) => childContactToIntakeEntry(contact, clientFirstName, spouseFirstName))
  if (children.length > 0) out._children = children

  const fiduciaryMap: Record<string, Array<Record<string, unknown>>> = {}
  for (const contact of contacts) {
    for (const role of contact.contact_roles ?? []) {
      if (role.is_coagent === true) continue
      const slot = ROLE_PARTY_TO_SLOT[`${role.role}|${role.for_party}`]
      if (!slot) continue
      const priority = typeof role.priority === 'number' ? role.priority : 0
      if (priority < 1 || priority > MAX_FIDUCIARY_PRIORITY) continue

      const entry = fiduciaryEntryFromContact(contact)
      if (!text(entry.first_name) && !text(entry.last_name)) continue
      const key = `_${slot}`
      if (!fiduciaryMap[key]) fiduciaryMap[key] = []
      fiduciaryMap[key][priority - 1] = {
        ...entry,
        priority,
        is_coagent: false,
      }
    }
  }

  for (const [key, entries] of Object.entries(fiduciaryMap)) {
    out[key] = entries.filter(Boolean)
  }

  const additionalContacts = contacts
    .filter((contact) => String(contact.source ?? '') === CLIENT_INTAKE_ADDITIONAL_SOURCE)
    .map(additionalContactToIntakeEntry)
  if (additionalContacts.length > 0) out._additional_contacts = additionalContacts

  return out
}

export async function hydrateIntakeWithContacts(
  client: DbClient,
  intake: Record<string, unknown>,
  intakeId = String(intake.id ?? ''),
): Promise<Record<string, unknown>> {
  if (!intakeId) return intake

  const { data, error } = await client
    .from('contacts')
    .select('*, contact_roles(*)')
    .eq('client_intake_id', intakeId)

  if (error) throw new Error(error.message)
  return applyContactIntakeData(intake, (data ?? []) as ContactRow[])
}
