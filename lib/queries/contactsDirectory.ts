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

/** Which engagement a person's directory row should speak for. */
const KIND_PRIORITY: Record<ContactKind, number> = {
  client: 0,
  lead: 1,
  lost: 2,
  other: 3,
}

/**
 * Collapse one person's engagements into a single directory row.
 *
 * A returning client has one `client_intake` row per engagement (§12.3 of
 * docs/matter-contacts-migration.md) but one `self` contact across all of them.
 * The directory lists people, so the rows are merged: the live engagement
 * supplies the link and the comms thread, and every matter number is kept so
 * searching any of them still finds the person.
 *
 * Split out from the query so it can be tested without a database.
 */
export function mergePersonRows(group: ContactDirectoryRow[]): ContactDirectoryRow {
  if (group.length === 1) return group[0]

  // A hired matter wins over a lead, and the newest wins within a kind — the
  // same precedence unify_leads_matters used to pick an intake's matter.
  const ordered = [...group].sort((a, b) => {
    const byKind = KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind]
    if (byKind !== 0) return byKind
    return String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''))
  })
  const primary = ordered[0]

  const matterNumbers = [...new Set(
    ordered.map(row => row.matter_number).filter((n): n is string => Boolean(n)),
  )]
  // Earliest, so sorting by created_at answers "since when has the firm known
  // this person" rather than "when did their latest engagement open".
  const firstSeen = group
    .map(row => row.created_at)
    .filter((d): d is string => Boolean(d))
    .sort()[0] ?? primary.created_at

  return {
    ...primary,
    matter_number: matterNumbers.length ? matterNumbers.join(', ') : null,
    created_at: firstSeen,
    // Fall back across engagements: an older one may carry contact details a
    // newer, thinner intake left blank.
    email: ordered.find(row => row.email)?.email ?? null,
    phone: ordered.find(row => row.phone)?.phone ?? null,
    practice_area: ordered.find(row => row.practice_area)?.practice_area ?? null,
    city: ordered.find(row => row.city)?.city ?? null,
    state: ordered.find(row => row.state)?.state ?? null,
  }
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
      // 'self' contacts are the client themselves, already listed above from
      // client_intake — see 20260925000000_matter_contacts_join.sql. Listing
      // both shows the same person twice whenever they carry no email for the
      // dedupe below to catch.
      .not('relationship_type', 'in', '("client","self")')
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

  // A second engagement gets its own client_intake row (docs/matter-contacts-
  // migration.md §12.3), so a returning client is two intakes and would list
  // twice. They share one `self` contact, which is what identifies the person
  // across engagements — group on it so the directory lists people, not
  // engagements.
  const { data: selfJoins } = matterIds.length
    ? await admin
        .from('matter_contacts')
        .select('matter_id, contact_id')
        .eq('relationship_type', 'self')
        .in('matter_id', matterIds)
    : { data: [] as Array<{ matter_id: string; contact_id: string }> }
  const selfContactByMatter = new Map(
    ((selfJoins ?? []) as Array<{ matter_id: string; contact_id: string }>)
      .map(row => [row.matter_id, row.contact_id]),
  )
  /** Rows for the same person, keyed by their shared self contact. */
  const personGroups = new Map<string, ContactDirectoryRow[]>()

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

    const row: ContactDirectoryRow = {
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
      self_contact_id: intake.matter_id ? selfContactByMatter.get(intake.matter_id) ?? null : null,
    }

    const selfContactId = row.self_contact_id ?? undefined
    if (selfContactId) {
      personGroups.set(selfContactId, [...(personGroups.get(selfContactId) ?? []), row])
    } else {
      // No self contact yet — an intake with no matter, or one predating the
      // join backfill. Listed on its own, exactly as before.
      rows.push(row)
    }
  }

  for (const group of personGroups.values()) {
    rows.push(mergePersonRows(group))
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
      // A relationship contact is already the person — a child here is the same
      // row that becomes `self` on their own College Prep matter.
      self_contact_id: contact.id,
    })
  }

  return { rows, error: null }
}
