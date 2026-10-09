import { loadIntakeCreationContext } from '@/lib/intake/creationContext'
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeContactRelationshipType } from '@/lib/contactRelationship'
import { syncChildrenProjection } from '@/lib/contacts/syncChildrenProjection'
import { formatPhoneForStorage } from '@/lib/phone'
import type { Database } from '@/types/supabase'
import { attachContactToMatter, matterIdForIntake } from '@/lib/contacts/attachContactToMatter'

export interface LeadFiduciaryContact {
  name: string
  relationship: string | null
  address: string | null
  email: string | null
  phone: string | null
  suffix: string | null
  preferred_name: string | null
  preferred_pronoun: string | null
}

export interface LeadFiduciaryContactInput {
  name?: unknown
  relationship?: unknown
  address?: unknown
  email?: unknown
  phone?: unknown
  suffix?: unknown
  preferred_name?: unknown
  preferred_pronoun?: unknown
}

const MAX_FIDUCIARY_CONTACTS = 12
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const LEAD_FIDUCIARY_CONTACT_SOURCE = 'public_lead_intake_fiduciary'
export const ADMIN_FIDUCIARY_CONTACT_SOURCE = 'admin_fiduciary_contact'

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
}

export function sanitizeLeadFiduciaryContacts(
  input: unknown,
): { contacts: LeadFiduciaryContact[]; error: string | null } {
  if (input == null) return { contacts: [], error: null }
  if (!Array.isArray(input)) {
    return { contacts: [], error: 'Fiduciaries must be an array' }
  }
  if (input.length > MAX_FIDUCIARY_CONTACTS) {
    return { contacts: [], error: `Please limit fiduciaries to ${MAX_FIDUCIARY_CONTACTS} contacts` }
  }

  const contacts: LeadFiduciaryContact[] = []
  for (const item of input as LeadFiduciaryContactInput[]) {
    const name = clean(item?.name)
    const relationship = clean(item?.relationship)
    const address = clean(item?.address)
    const email = clean(item?.email)
    const phone = formatPhoneForStorage(clean(item?.phone)) ?? ''
    const suffix = clean(item?.suffix)
    const preferredName = clean(item?.preferred_name)
    const preferredPronoun = clean(item?.preferred_pronoun)

    if (!name && !relationship && !address && !email && !phone && !suffix && !preferredName && !preferredPronoun) continue
    if (!name) return { contacts: [], error: 'Each fiduciary contact needs a name' }
    if (email && !emailPattern.test(email)) {
      return { contacts: [], error: `Invalid email for fiduciary contact ${name}` }
    }

    contacts.push({
      name,
      relationship: relationship || null,
      address: address || null,
      email: email || null,
      phone: phone || null,
      suffix: suffix || null,
      preferred_name: preferredName || null,
      preferred_pronoun: preferredPronoun || null,
    })
  }

  return { contacts, error: null }
}

export function formatLeadFiduciariesForNotes(contacts: LeadFiduciaryContact[]): string | null {
  if (contacts.length === 0) return null
  const lines = contacts.map((contact, index) => {
    const details = [
      contact.relationship ? `relationship: ${contact.relationship}` : null,
      contact.email ? `email: ${contact.email}` : null,
      contact.phone ? `phone: ${contact.phone}` : null,
      contact.address ? `address: ${contact.address}` : null,
    ].filter(Boolean)
    return `${index + 1}. ${contact.name}${details.length > 0 ? ` (${details.join('; ')})` : ''}`
  })
  return `Fiduciary contacts:\n${lines.join('\n')}`
}

export interface LeadFiduciaryContactRow {
  client_intake_id: string
  first_name: string
  last_name: string | null
  suffix: string | null
  preferred_name: string | null
  preferred_pronoun: string | null
  email: string | null
  phone: string | null
  address_line1: string | null
  relationship_type: 'client' | 'spouse' | 'child' | 'other'
  relationship_label: string | null
  source: string
  created_by_client_at: string
}

export interface AttachLeadFiduciaryContactsArgs {
  leadId: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  contacts: LeadFiduciaryContact[]
  source?: string
}

export interface AttachLeadFiduciaryContactsResult {
  intakeId: string | null
  insertedContactCount: number
}

export interface InsertFiduciaryContactsForIntakeArgs {
  clientIntakeId: string
  contacts: LeadFiduciaryContact[]
  source?: string
}

export interface InsertFiduciaryContactsForIntakeResult {
  insertedContactCount: number
}

interface ExistingLeadFiduciaryContact {
  first_name: string | null
  last_name: string | null
  email: string | null
  source: string | null
}

function splitLeadFiduciaryName(name: string): { firstName: string; lastName: string | null } {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length <= 1) return { firstName: parts[0] ?? name.trim(), lastName: null }
  return {
    firstName: parts.slice(0, -1).join(' '),
    lastName: parts[parts.length - 1],
  }
}

function contactDedupeKey(row: {
  first_name: string | null
  last_name: string | null
  email: string | null
  source: string | null
}): string {
  return [
    row.source ?? '',
    row.first_name ?? '',
    row.last_name ?? '',
    row.email ?? '',
  ].map(part => part.trim().toLowerCase()).join('|')
}

export function buildLeadFiduciaryContactRows(
  clientIntakeId: string,
  contacts: LeadFiduciaryContact[],
  createdAt = new Date().toISOString(),
  source = LEAD_FIDUCIARY_CONTACT_SOURCE,
): LeadFiduciaryContactRow[] {
  return contacts.map((contact) => {
    const { firstName, lastName } = splitLeadFiduciaryName(contact.name)
    return {
      client_intake_id: clientIntakeId,
      first_name: firstName,
      last_name: lastName,
      suffix: contact.suffix,
      preferred_name: contact.preferred_name,
      preferred_pronoun: contact.preferred_pronoun,
      email: contact.email,
      phone: formatPhoneForStorage(contact.phone),
      address_line1: contact.address,
      relationship_type: normalizeContactRelationshipType(contact.relationship, contact.relationship),
      relationship_label: contact.relationship,
      source,
      created_by_client_at: createdAt,
    }
  })
}

export async function insertFiduciaryContactsForIntake(
  admin: SupabaseClient<Database>,
  args: InsertFiduciaryContactsForIntakeArgs,
): Promise<InsertFiduciaryContactsForIntakeResult> {
  if (args.contacts.length === 0) return { insertedContactCount: 0 }

  const source = args.source ?? LEAD_FIDUCIARY_CONTACT_SOURCE
  const rows = buildLeadFiduciaryContactRows(args.clientIntakeId, args.contacts, new Date().toISOString(), source)
  const { data: existingContacts, error: existingContactsError } = await admin
    .from('contacts')
    .select('first_name, last_name, email, source')
    .eq('client_intake_id', args.clientIntakeId)
    .eq('source', source)

  if (existingContactsError) throw existingContactsError

  const existingKeys = new Set(
    ((existingContacts ?? []) as ExistingLeadFiduciaryContact[]).map(contactDedupeKey),
  )
  const rowsToInsert = rows.filter(row => !existingKeys.has(contactDedupeKey(row)))

  if (rowsToInsert.length === 0) {
    return { insertedContactCount: 0 }
  }

  const { data: insertedContacts, error: contactsInsertError } = await admin
    .from('contacts').insert(rowsToInsert).select('id, relationship_type')
  if (contactsInsertError) throw contactsInsertError

  // Step 7a: attach each to the lead's matter directly. Without this they would
  // rely on sync_matter_contacts_from_contact, which goes with the column in 7b.
  const leadMatterId = await matterIdForIntake(admin, args.clientIntakeId)
  for (const row of (insertedContacts ?? []) as Array<{ id: string; relationship_type: string | null }>) {
    await attachContactToMatter(admin, leadMatterId, row.id, {
      relationship_type: row.relationship_type ?? 'other',
    })
  }

  if (rowsToInsert.some((row) => row.relationship_type === 'child')) {
    await syncChildrenProjection(admin, args.clientIntakeId)
  }

  return { insertedContactCount: rowsToInsert.length }
}

export async function attachLeadFiduciaryContacts(
  admin: SupabaseClient<Database>,
  args: AttachLeadFiduciaryContactsArgs,
): Promise<AttachLeadFiduciaryContactsResult> {
  if (args.contacts.length === 0) return { intakeId: null, insertedContactCount: 0 }

  const { data: existingIntake, error: intakeLookupError } = await admin
    .from('client_intake')
    .select('id')
    .eq('lead_id', args.leadId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (intakeLookupError) throw intakeLookupError

  let intakeId = typeof existingIntake?.id === 'string' ? existingIntake.id : null
  if (!intakeId) {
    const creationContext = await loadIntakeCreationContext(admin, { leadId: args.leadId })
    const fullName = [args.firstName, args.lastName].filter(Boolean).join(' ') || null
    const { data: createdIntake, error: createIntakeError } = await admin
      .from('client_intake')
      .insert({
        lead_id: args.leadId,
        first_name: args.firstName,
        last_name: args.lastName,
        full_name: fullName,
        email: args.email,
        phone: formatPhoneForStorage(args.phone),
        ...creationContext,
        status: 'draft',
        current_step: 1,
        state: 'MA',
        is_us_citizen: true,
      })
      .select('id')
      .single()

    if (createIntakeError) throw createIntakeError
    intakeId = typeof createdIntake?.id === 'string' ? createdIntake.id : null
  }

  if (!intakeId) throw new Error('Failed to attach fiduciary contacts to lead intake')

  const result = await insertFiduciaryContactsForIntake(admin, {
    clientIntakeId: intakeId,
    contacts: args.contacts,
    source: args.source,
  })

  return { intakeId, insertedContactCount: result.insertedContactCount }
}
