import { getAdminClient } from '@/lib/supabaseAdmin'
import { formatPhoneDisplay } from '@/lib/phone'
import {
  type ContactDirectoryRow,
  type ContactKind,
} from '@/lib/adminTables/contactTable'

interface IntakeRow {
  id: string
  full_name: string | null
  first_name: string | null
  last_name: string | null
  preferred_name: string | null
  email: string | null
  phone: string | null
  city: string | null
  state: string | null
  practice_area: string | null
  lead_status: string | null
  matter_id: string | null
  created_at: string | null
}

function personName(row: {
  full_name?: string | null
  preferred_name?: string | null
  first_name?: string | null
  last_name?: string | null
}): string {
  const full = row.full_name?.trim()
  if (full) return full
  const first = row.preferred_name?.trim() || row.first_name?.trim() || ''
  const last = row.last_name?.trim() || ''
  return [first, last].filter(Boolean).join(' ')
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/**
 * Every person the firm knows, as one list: leads and clients from
 * client_intake (kind decided by the linked matter's relationship_status),
 * plus relationship contacts (spouses, children, fiduciaries) that aren't
 * already present as an intake. Same union the email directory uses.
 */
export async function fetchContactsDirectory(): Promise<{ rows: ContactDirectoryRow[]; error: string | null }> {
  const admin = getAdminClient()

  const [intakesRes, contactsRes] = await Promise.all([
    admin
      .from('client_intake')
      .select('id, full_name, first_name, last_name, preferred_name, email, phone, city, state, practice_area, lead_status, matter_id, created_at')
      .order('created_at', { ascending: false })
      .limit(1000),
    admin
      .from('contacts')
      .select('id, client_intake_id, first_name, last_name, preferred_name, email, phone, city, state, relationship_type, relationship_label, deceased, created_at')
      .neq('relationship_type', 'client')
      .order('created_at', { ascending: false })
      .limit(2000),
  ])

  if (intakesRes.error) return { rows: [], error: intakesRes.error.message }
  if (contactsRes.error) return { rows: [], error: contactsRes.error.message }

  const intakes = (intakesRes.data ?? []) as IntakeRow[]

  const matterIds = intakes.map(row => row.matter_id).filter((id): id is string => Boolean(id))
  const { data: matters } = matterIds.length
    ? await admin
        .from('matters')
        .select('id, matter_number, relationship_status, status')
        .in('id', matterIds)
    : { data: [] as Array<{ id: string; matter_number: string | null; relationship_status: string | null; status: string | null }> }
  const matterById = new Map((matters ?? []).map(row => [row.id, row]))

  const rows: ContactDirectoryRow[] = []
  const intakeNameById = new Map<string, string>()
  const intakeHrefById = new Map<string, string>()
  const intakeThreadById = new Map<string, { type: 'lead' | 'matter'; id: string }>()
  const seenEmails = new Set<string>()

  for (const intake of intakes) {
    const matter = intake.matter_id ? matterById.get(intake.matter_id) : undefined
    if (matter?.status === 'archived') continue

    const relationshipStatus = matter?.relationship_status ?? intake.lead_status
    let kind: ContactKind
    if (relationshipStatus === 'hired') kind = 'client'
    else if (relationshipStatus === 'lost') kind = 'lost'
    else if (relationshipStatus === 'lead') kind = 'lead'
    // Matter-origin intakes predating the lead pipeline have no status — those are clients.
    else kind = 'client'

    const name = personName(intake) || intake.email?.trim() || 'Unnamed'
    intakeNameById.set(intake.id, name)
    const email = intake.email?.trim().toLowerCase() || null
    if (email) seenEmails.add(email)

    // Clients live on the matter record; leads (and lost leads) on the lead record.
    const href = kind === 'client' && intake.matter_id
      ? `/admin/matters/${intake.matter_id}`
      : `/admin/crm/opportunities/${intake.id}`
    intakeHrefById.set(intake.id, href)
    // Comms (SMS/email/calls) thread through the same record.
    const thread: { type: 'lead' | 'matter'; id: string } = kind === 'client' && intake.matter_id
      ? { type: 'matter', id: intake.matter_id }
      : { type: 'lead', id: intake.id }
    intakeThreadById.set(intake.id, thread)

    rows.push({
      id: `intake:${intake.id}`,
      kind,
      name,
      email: intake.email?.trim() || null,
      phone: formatPhoneDisplay(intake.phone) || null,
      relationship: null,
      practice_area: intake.practice_area,
      city: intake.city,
      state: intake.state,
      href,
      matter_number: matter?.matter_number ?? null,
      created_at: intake.created_at,
      thread,
      relationship_type: null,
    })
  }

  for (const contact of contactsRes.data ?? []) {
    if (contact.deceased) continue
    const name = personName(contact)
    if (!name) continue
    // Design sheets record undecided fiduciaries as placeholder contacts.
    if (/^(to be determined|tbd)$/i.test(name)) continue
    // Skip people already in the list as a lead/client under the same address.
    const email = typeof contact.email === 'string' ? contact.email.trim().toLowerCase() : ''
    if (email && seenEmails.has(email)) continue
    if (email) seenEmails.add(email)

    const relatedName = contact.client_intake_id ? intakeNameById.get(contact.client_intake_id) : undefined
    const label = contact.relationship_label?.trim()
      || (contact.relationship_type ? titleCase(contact.relationship_type) : 'Contact')

    rows.push({
      id: `contact:${contact.id}`,
      kind: 'other',
      name,
      email: contact.email?.trim() || null,
      phone: formatPhoneDisplay(contact.phone) || null,
      relationship: relatedName ? `${label} · ${relatedName}` : label,
      practice_area: null,
      city: contact.city,
      state: contact.state,
      // A relationship contact has no record of its own — link to the person it belongs to.
      href: (contact.client_intake_id && intakeHrefById.get(contact.client_intake_id)) || null,
      matter_number: null,
      created_at: contact.created_at,
      thread: (contact.client_intake_id && intakeThreadById.get(contact.client_intake_id)) || null,
      relationship_type: contact.relationship_type ?? null,
    })
  }

  return { rows, error: null }
}
