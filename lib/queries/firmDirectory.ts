import { getAdminClient } from '@/lib/supabaseAdmin'

/**
 * The firm's people, as one un-deduped list, plus the per-channel projections
 * the phone and email directories need.
 *
 * The two directories used to query different tables and drifted: the phone
 * one read `v_matter_pipeline` (hired matters only) and never touched
 * `contacts` at all, so fiduciaries, children and standalone referrers were
 * undialable, while the email one included them. Both now project from the
 * same `fetchFirmPeople()` result.
 *
 * Deliberately un-deduped: dedupe belongs to the channel, not the source. The
 * contacts page collapses people by email; doing that here would drop a
 * contact who shares an email with an intake but carries a *different* phone —
 * losing exactly the numbers this list exists to provide.
 */

/** Lower rank wins a shared number or address. */
const RANK = {
  client: 0,
  clientContact: 1,
  lead: 2,
  leadContact: 3,
  lost: 4,
  lostContact: 5,
  /** No intake behind them — a referrer, a professional, opposing counsel. */
  standaloneContact: 6,
} as const

export type FirmRelationshipStatus = 'hired' | 'lead' | 'lost'

export interface FirmPerson {
  source: 'intake' | 'contact'
  intakeId: string | null
  contactId: string | null
  /** Set only for people on a hired matter — mirrors how comms thread today. */
  matterId: string | null
  matterNumber: string | null
  /** Set only for people on a lead (or lost lead). */
  leadId: string | null
  name: string
  phone: string | null
  email: string | null
  /** The sub-label a picker shows under the name. */
  detail: string | null
  relationshipType: string | null
  relationshipStatus: FirmRelationshipStatus
  practiceArea: string | null
  stage: string | null
  rank: number
}

export interface PhoneDirectoryEntry {
  /** last 10 digits — the match key */
  digits: string
  name: string
  detail: string | null
  matterId: string | null
  matterNumber: string | null
  leadId: string | null
  contactId: string | null
  practiceArea: string | null
  stage: string | null
}

export interface EmailDirectoryEntry {
  email: string
  name: string
  /** Where this address came from — matter number, "Lead", or a relationship. */
  detail: string | null
}

// ── shared normalization ────────────────────────────────────────────────────

export function last10(value: unknown): string | null {
  const digits = typeof value === 'string' ? value.replace(/\D/g, '') : ''
  return digits.length >= 10 ? digits.slice(-10) : null
}

export function cleanEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null
}

function personName(row: {
  full_name?: unknown
  preferred_name?: unknown
  first_name?: unknown
  last_name?: unknown
}): string {
  const full = typeof row.full_name === 'string' ? row.full_name.trim() : ''
  if (full) return full
  const first =
    (typeof row.preferred_name === 'string' && row.preferred_name.trim()) ||
    (typeof row.first_name === 'string' ? row.first_name.trim() : '')
  const last = typeof row.last_name === 'string' ? row.last_name.trim() : ''
  return [first, last].filter(Boolean).join(' ')
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/** Design sheets record undecided fiduciaries as placeholder contacts. */
function isPlaceholderName(name: string): boolean {
  return /^(to be determined|tbd)$/i.test(name.trim())
}

// ── source ──────────────────────────────────────────────────────────────────

interface IntakeRow {
  id: string
  full_name: string | null
  first_name: string | null
  last_name: string | null
  preferred_name: string | null
  email: string | null
  phone: string | null
  practice_area: string | null
  lead_status: string | null
  matter_id: string | null
}

interface ContactRow {
  id: string
  client_intake_id: string | null
  first_name: string | null
  last_name: string | null
  preferred_name: string | null
  email: string | null
  phone: string | null
  relationship_type: string | null
  relationship_label: string | null
  deceased: boolean | null
}

interface MatterRow {
  id: string
  matter_number: string | null
  relationship_status: string | null
  status: string | null
  stage: string | null
}

/**
 * Read from the base tables rather than `v_matter_pipeline_all`: the view
 * doesn't expose `client_intake.id` (needed to thread a lead), and its
 * denormalized spouse columns are redundant once every `contacts` row is
 * queried anyway.
 */
export async function fetchFirmPeople(): Promise<{ people: FirmPerson[]; error: string | null }> {
  const admin = getAdminClient()

  const [intakesRes, contactsRes, mattersRes] = await Promise.all([
    admin
      .from('client_intake')
      .select('id, full_name, first_name, last_name, preferred_name, email, phone, practice_area, lead_status, matter_id')
      .limit(5000),
    admin
      .from('contacts')
      .select('id, client_intake_id, first_name, last_name, preferred_name, email, phone, relationship_type, relationship_label, deceased')
      .limit(5000),
    admin
      .from('matters')
      .select('id, matter_number, relationship_status, status, stage')
      .neq('status', 'archived'),
  ])

  if (intakesRes.error) return { people: [], error: intakesRes.error.message }
  if (contactsRes.error) return { people: [], error: contactsRes.error.message }
  if (mattersRes.error) return { people: [], error: mattersRes.error.message }

  return {
    people: buildFirmPeople(
      (intakesRes.data ?? []) as IntakeRow[],
      (contactsRes.data ?? []) as ContactRow[],
      (mattersRes.data ?? []) as MatterRow[],
    ),
    error: null,
  }
}

/** Split out from the query so it can be tested without a database. */
export function buildFirmPeople(
  intakes: IntakeRow[],
  contacts: ContactRow[],
  matters: MatterRow[],
): FirmPerson[] {
  const matterById = new Map(matters.map(row => [row.id, row]))
  const people: FirmPerson[] = []

  /** What a contact inherits from the intake it hangs off. */
  const ownerByIntakeId = new Map<string, {
    name: string
    matterId: string | null
    matterNumber: string | null
    leadId: string | null
    relationshipStatus: FirmRelationshipStatus
    practiceArea: string | null
    stage: string | null
  }>()

  for (const intake of intakes) {
    // A matter row missing from the map was archived out of the query.
    const matter = intake.matter_id ? matterById.get(intake.matter_id) : undefined
    if (intake.matter_id && !matter) continue

    const raw = matter?.relationship_status ?? intake.lead_status
    // Matter-origin intakes predating the lead pipeline have no status — clients.
    const relationshipStatus: FirmRelationshipStatus =
      raw === 'lead' ? 'lead' : raw === 'lost' ? 'lost' : 'hired'

    // Clients thread through the matter, leads through the intake — the same
    // split `fetchContactsDirectory` makes.
    const isClient = relationshipStatus === 'hired'
    const matterId = isClient ? intake.matter_id : null
    const matterNumber = isClient ? matter?.matter_number ?? null : null
    const leadId = isClient ? null : intake.id

    const detail = isClient
      ? matterNumber ?? 'Client'
      : relationshipStatus === 'lost'
        ? 'Lost lead'
        : 'Lead'

    const name = personName(intake)
    const owner = {
      name,
      matterId,
      matterNumber,
      leadId,
      relationshipStatus,
      practiceArea: intake.practice_area,
      stage: matter?.stage ?? null,
    }
    ownerByIntakeId.set(intake.id, owner)

    if (!name || isPlaceholderName(name)) continue

    people.push({
      source: 'intake',
      intakeId: intake.id,
      contactId: null,
      matterId,
      matterNumber,
      leadId,
      name,
      phone: intake.phone,
      email: intake.email,
      detail,
      relationshipType: null,
      relationshipStatus,
      practiceArea: intake.practice_area,
      stage: matter?.stage ?? null,
      rank:
        relationshipStatus === 'hired' ? RANK.client
          : relationshipStatus === 'lead' ? RANK.lead
            : RANK.lost,
    })
  }

  for (const contact of contacts) {
    if (contact.deceased) continue
    // A 'self' contact is the client, already emitted from client_intake above
    // — see 20260925000000_matter_contacts_join.sql. Emitting it again would
    // list the same person twice in every picker this feeds.
    if (contact.relationship_type === 'self') continue
    const name = personName(contact)
    if (!name || isPlaceholderName(name)) continue

    const owner = contact.client_intake_id ? ownerByIntakeId.get(contact.client_intake_id) : undefined
    // A contact whose intake was archived out of the matters query is orphaned.
    if (contact.client_intake_id && !owner) continue

    const label =
      contact.relationship_label?.trim() ||
      (contact.relationship_type ? titleCase(contact.relationship_type) : 'Contact')

    people.push({
      source: 'contact',
      intakeId: contact.client_intake_id,
      contactId: contact.id,
      matterId: owner?.matterId ?? null,
      matterNumber: owner?.matterNumber ?? null,
      leadId: owner?.leadId ?? null,
      name,
      phone: contact.phone,
      email: contact.email,
      // "Trustee · Jane Smith" reads better in a picker than a bare role.
      detail: owner ? `${label} · ${owner.name}` : label,
      relationshipType: contact.relationship_type,
      relationshipStatus: owner?.relationshipStatus ?? 'hired',
      practiceArea: owner?.practiceArea ?? null,
      stage: owner?.stage ?? null,
      rank: !owner
        ? RANK.standaloneContact
        : owner.relationshipStatus === 'hired' ? RANK.clientContact
          : owner.relationshipStatus === 'lead' ? RANK.leadContact
            : RANK.lostContact,
    })
  }

  return people
}

// ── projections ─────────────────────────────────────────────────────────────

/**
 * Dedupe on the last ten digits, lowest rank winning, so an active matter
 * always beats a lead on a shared household number — the precedence the
 * softphone has always had, now made explicit instead of insertion-ordered.
 * Left in rank order (not alphabetical) so a partial-dial prefix match resolves
 * to the most specific person.
 */
export function toPhoneDirectory(people: FirmPerson[]): PhoneDirectoryEntry[] {
  const seen = new Set<string>()
  const entries: PhoneDirectoryEntry[] = []

  for (const person of [...people].sort((a, b) => a.rank - b.rank)) {
    const digits = last10(person.phone)
    if (!digits || seen.has(digits)) continue
    seen.add(digits)
    entries.push({
      digits,
      name: person.name,
      detail: person.detail,
      matterId: person.matterId,
      matterNumber: person.matterNumber,
      leadId: person.leadId,
      contactId: person.contactId,
      practiceArea: person.practiceArea,
      stage: person.stage,
    })
  }

  return entries
}

/** Same dedupe, keyed on the address, then sorted by name for the typeahead. */
export function toEmailDirectory(people: FirmPerson[]): EmailDirectoryEntry[] {
  const seen = new Set<string>()
  const entries: EmailDirectoryEntry[] = []

  for (const person of [...people].sort((a, b) => a.rank - b.rank)) {
    const email = cleanEmail(person.email)
    if (!email || seen.has(email)) continue
    seen.add(email)
    entries.push({ email, name: person.name, detail: person.detail })
  }

  entries.sort((a, b) => a.name.localeCompare(b.name))
  return entries
}
