import 'server-only'

import { after } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getAdminClient } from '@/lib/supabaseAdmin'
import {
  conflictDigest,
  conflictResult,
  describeConflictCheck,
  distinct,
  findConflicts,
  type ConflictCandidate,
  type ConflictCheckState,
  type ConflictDecision,
  type ConflictHit,
  type ConflictSubject,
} from './match'

/**
 * Conflict-of-interest checks: the reads and writes.
 *
 * runConflictCheck builds the subject from the lead (and their spouse when one
 * is on record), loads every person the firm knows from three places
 * (intakes, matters, contacts and their roles), matches, stores the run, and,
 * when something matched, asks the attorney to look through the delegation
 * dial. The lead's own records are excluded: the trigger that opens the
 * opportunity also writes a self contact, which would otherwise match itself.
 */

type Admin = SupabaseClient
type Loose = Record<string, unknown>

function isMissingTable(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false
  if (error.code === '42P01' || error.code === 'PGRST205') return true
  return /relation .* does not exist|could not find the table/i.test(error.message ?? '')
}

function jsonStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(entry => {
    if (typeof entry === 'string') return [entry]
    if (entry && typeof entry === 'object') {
      const record = entry as Loose
      return [record.email, record.phone, record.value, record.address].filter((v): v is string => typeof v === 'string')
    }
    return []
  })
}

function personNames(row: Loose): string[] {
  const first = typeof row.first_name === 'string' ? row.first_name : ''
  const last = typeof row.last_name === 'string' ? row.last_name : ''
  const preferred = typeof row.preferred_name === 'string' ? row.preferred_name : ''
  const full = typeof row.full_name === 'string' ? row.full_name : ''
  const prior = typeof row.prior_names === 'string' ? row.prior_names : ''
  return distinct([
    full,
    [first, last].filter(Boolean).join(' '),
    preferred && last ? `${preferred} ${last}` : '',
    ...prior.split(/[;,]/).map(name => name.trim()),
  ])
}

function personLabel(row: Loose, fallback = 'Unnamed'): string {
  return personNames(row)[0] ?? (typeof row.email === 'string' && row.email) ?? fallback
}

/** Everything the lead could be found under, plus their spouse when one is on record. */
export async function buildConflictSubject(leadId: string, admin: Admin = getAdminClient()): Promise<{ subject: ConflictSubject; matterId: string | null; label: string } | null> {
  const { data: lead, error } = await admin
    .from('client_intake')
    .select('id, first_name, last_name, full_name, preferred_name, prior_names, email, phone, additional_emails, additional_phones, matter_id')
    .eq('id', leadId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!lead) return null
  const row = lead as Loose

  const names = personNames(row)
  const emails = distinct([row.email as string | null, ...jsonStrings(row.additional_emails)])
  const phones = distinct([row.phone as string | null, ...jsonStrings(row.additional_phones)])

  // The spouse is a contact on the lead's own matter. Their identity matters
  // as much as the lead's: the spouse of a new lead may be the firm's client.
  const { data: household } = await admin
    .from('contacts')
    .select('first_name, last_name, preferred_name, prior_names, email, phone, additional_emails, additional_phones, relationship_type, merged_into_id')
    .eq('client_intake_id', leadId)
    .is('merged_into_id', null)
  for (const member of (household ?? []) as Loose[]) {
    if (member.relationship_type !== 'spouse') continue
    names.push(...personNames(member))
    emails.push(member.email as string, ...jsonStrings(member.additional_emails))
    phones.push(member.phone as string, ...jsonStrings(member.additional_phones))
  }

  return {
    subject: { names: distinct(names), emails: distinct(emails), phones: distinct(phones) },
    matterId: (row.matter_id as string | null) ?? null,
    label: personLabel(row, 'this lead'),
  }
}

/**
 * Every person the firm knows, other than the lead's own records: each intake
 * (a lead or a client), with its matter for the label; each contact (spouses,
 * children, beneficiaries, fiduciaries) with the roles they hold.
 */
export async function loadConflictCandidates(exclude: { leadId: string; matterId: string | null }, admin: Admin = getAdminClient()): Promise<ConflictCandidate[]> {
  const [intakes, matters, contacts, roles] = await Promise.all([
    admin.from('client_intake')
      .select('id, first_name, last_name, full_name, preferred_name, prior_names, email, phone, additional_emails, additional_phones, lead_status, matter_id'),
    admin.from('matters').select('id, name, relationship_status, client_intake_id'),
    admin.from('contacts')
      .select('id, first_name, last_name, preferred_name, prior_names, email, phone, additional_emails, additional_phones, relationship_type, relationship_label, client_intake_id, merged_into_id')
      .is('merged_into_id', null),
    admin.from('contact_roles').select('contact_id, role, matter_id, client_intake_id'),
  ])
  for (const result of [intakes, matters, contacts, roles]) {
    if (result.error) throw new Error(result.error.message)
  }

  const matterRows = (matters.data ?? []) as Loose[]
  const matterByIntake = new Map<string, Loose>()
  const matterById = new Map<string, Loose>()
  for (const matter of matterRows) {
    matterById.set(matter.id as string, matter)
    if (typeof matter.client_intake_id === 'string') matterByIntake.set(matter.client_intake_id, matter)
  }

  const ROLE_LABELS: Record<string, string> = {
    personal_rep: 'Personal representative', trustee: 'Trustee', poa: 'Agent under POA', hcp: 'Health care agent', guardian: 'Guardian',
  }
  const rolesByContact = new Map<string, string[]>()
  for (const role of (roles.data ?? []) as Loose[]) {
    const contactId = role.contact_id as string
    const label = ROLE_LABELS[role.role as string] ?? String(role.role)
    const matter = typeof role.matter_id === 'string' ? matterById.get(role.matter_id) : undefined
    const text = matter?.name ? `${label} · ${matter.name as string}` : label
    rolesByContact.set(contactId, [...(rolesByContact.get(contactId) ?? []), text])
  }

  const candidates: ConflictCandidate[] = []

  for (const intake of (intakes.data ?? []) as Loose[]) {
    const id = intake.id as string
    if (id === exclude.leadId) continue
    const matter = matterByIntake.get(id) ?? (typeof intake.matter_id === 'string' ? matterById.get(intake.matter_id) : undefined)
    const hired = matter?.relationship_status === 'hired' || intake.lead_status === 'hired'
    const status = typeof intake.lead_status === 'string' ? intake.lead_status : null
    const context = hired
      ? `Client · ${(matter?.name as string | undefined) ?? 'matter'}`
      : status ? `Lead · ${status}` : 'Intake'
    candidates.push({
      kind: hired ? 'matter' : 'lead',
      id,
      label: personLabel(intake),
      context,
      href: hired && matter ? `/admin/matters/${matter.id as string}` : `/admin/leads/${id}`,
      names: personNames(intake),
      emails: distinct([intake.email as string | null, ...jsonStrings(intake.additional_emails)]),
      phones: distinct([intake.phone as string | null, ...jsonStrings(intake.additional_phones)]),
    })
  }

  for (const contact of (contacts.data ?? []) as Loose[]) {
    if (contact.client_intake_id === exclude.leadId) continue
    if (contact.relationship_type === 'self') continue // the client themselves, already a candidate above
    const owner = typeof contact.client_intake_id === 'string' ? matterByIntake.get(contact.client_intake_id) : undefined
    const relationship = typeof contact.relationship_label === 'string' && contact.relationship_label
      ? contact.relationship_label
      : String(contact.relationship_type ?? 'contact').replace(/_/g, ' ')
    const roleText = rolesByContact.get(contact.id as string) ?? []
    const where = owner?.name ? ` · ${owner.name as string}` : ''
    candidates.push({
      kind: 'contact',
      id: contact.id as string,
      label: personLabel(contact),
      context: [`${relationship.charAt(0).toUpperCase()}${relationship.slice(1)}${where}`, ...roleText].join(' · '),
      href: owner ? `/admin/matters/${owner.id as string}?tab=people` : '/admin/contacts',
      names: personNames(contact),
      emails: distinct([contact.email as string | null, ...jsonStrings(contact.additional_emails)]),
      phones: distinct([contact.phone as string | null, ...jsonStrings(contact.additional_phones)]),
    })
  }

  return candidates
}

function toState(row: Loose): ConflictCheckState {
  return {
    id: String(row.id),
    result: row.result === 'possible' ? 'possible' : 'clear',
    decision: row.decision === 'conflict' ? 'conflict' : row.decision === 'no_conflict' ? 'no_conflict' : 'pending',
    hits: Array.isArray(row.hits) ? row.hits as ConflictHit[] : [],
    checkedAt: String(row.checked_at),
    decidedAt: (row.decided_at as string | null) ?? null,
    note: (row.note as string | null) ?? null,
  }
}

/** The lead's current check, or null when none has run (or the table is not there yet). */
export async function fetchLatestConflictCheck(leadId: string, admin: Admin = getAdminClient()): Promise<ConflictCheckState | null> {
  const { data, error } = await admin
    .from('conflict_checks')
    .select('id, result, decision, hits, checked_at, decided_at, note')
    .eq('client_intake_id', leadId)
    .order('checked_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    if (isMissingTable(error)) return null
    throw new Error(error.message)
  }
  return data ? toState(data as Loose) : null
}

/** Mirror onto the matter's legacy columns, so the matter page's pill and any old report agree. */
async function mirrorToMatterDetails(matterId: string | null, state: ConflictCheckState, admin: Admin): Promise<void> {
  if (!matterId) return
  const { error } = await admin.from('matter_details').update({
    conflict_check_completed: true,
    conflict_check_date: state.checkedAt.slice(0, 10),
    conflict_cleared: state.decision === 'no_conflict' || (state.result === 'clear' && state.decision !== 'conflict'),
  }).eq('client_id', matterId)
  if (error) console.error('[conflicts] matter_details mirror skipped', { matterId, cause: error.message })
}

/**
 * Search the lead against the firm's records and store the run. A clear
 * result stores itself as decided (no_conflict); a possible one is pending
 * and goes to the attorney through the dial as a task.
 */
export async function runConflictCheck(input: { leadId: string; actorId?: string | null }, admin: Admin = getAdminClient()): Promise<ConflictCheckState | null> {
  const built = await buildConflictSubject(input.leadId, admin)
  if (!built) return null
  const candidates = await loadConflictCandidates({ leadId: input.leadId, matterId: built.matterId }, admin)
  const hits = findConflicts(built.subject, candidates)
  const result = conflictResult(hits)

  const { data, error } = await admin
    .from('conflict_checks')
    .insert({
      client_intake_id: input.leadId,
      matter_id: built.matterId,
      result,
      decision: result === 'clear' ? 'no_conflict' : 'pending',
      query: built.subject,
      hits,
      decided_at: result === 'clear' ? new Date().toISOString() : null,
    })
    .select('id, result, decision, hits, checked_at, decided_at, note')
    .single()
  if (error) {
    if (isMissingTable(error)) return null
    throw new Error(error.message)
  }
  const state = toState(data as Loose)
  await mirrorToMatterDetails(built.matterId, state, admin)

  if (hits.length > 0) {
    await delegateConflictReview({ leadId: input.leadId, leadLabel: built.label, state })
  }
  return state
}

/** The attorney's call on a run with matches. A clear run needs none. */
export async function decideConflictCheck(
  input: { leadId: string; checkId: string; decision: Exclude<ConflictDecision, 'pending'>; note: string | null; actorId: string },
  admin: Admin = getAdminClient(),
): Promise<ConflictCheckState | null> {
  const now = new Date().toISOString()
  const { data, error } = await admin
    .from('conflict_checks')
    .update({ decision: input.decision, note: input.note, decided_at: now, decided_by: input.actorId })
    .eq('id', input.checkId)
    .eq('client_intake_id', input.leadId)
    .select('id, result, decision, hits, checked_at, decided_at, note, matter_id')
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  const state = toState(data as Loose)
  await mirrorToMatterDetails(((data as Loose).matter_id as string | null) ?? null, state, admin)
  return state
}

/**
 * A possible match is an attorney decision, so it is raised as a task through
 * the delegation dial: at Propose it waits as a card on Today, at Act it is
 * simply there in the morning. Keyed to the lead and the set of records
 * matched, so a re-run that finds the same people does not stack tasks.
 */
export async function delegateConflictReview(input: { leadId: string; leadLabel: string; state: ConflictCheckState }): Promise<'proposed' | 'done' | 'observed' | 'skipped' | 'failed'> {
  try {
    const { resolveUnattendedActor } = await import('@/lib/actions/delegation')
    const actor = await resolveUnattendedActor()
    if (!actor) return 'skipped'
    const { createActionProposal } = await import('@/lib/actions/server')
    const lines = input.state.hits.slice(0, 8).map(hit => `- ${hit.label} (${hit.context}): ${hit.matchedOn.join(', ')}`)
    const created = await createActionProposal({
      actionKey: 'task.create',
      displaySummary: `Review possible conflict: ${input.leadLabel}`,
      referencePayload: {
        title: `Conflict check: ${input.leadLabel}`.slice(0, 300),
        description: [describeConflictCheck(input.state), ...lines, 'Decide on the lead page: no conflict, or conflict.'].join('\n'),
        lead_id: input.leadId,
        priority: 'high',
      },
      recordType: 'lead',
      recordId: input.leadId,
      source: 'automation',
      idempotencyKey: `conflict-check:${input.leadId}:${conflictDigest(input.state.hits)}`,
      applyAutonomy: true,
    }, actor)
    if (created.duplicate) return 'skipped'
    if (created.autonomy === 'observe') return 'observed'
    if (created.execution) return created.execution.status === 'succeeded' ? 'done' : 'failed'
    return 'proposed'
  } catch (error) {
    console.error('[conflicts] review task not offered', { leadId: input.leadId, cause: error instanceof Error ? error.message : String(error) })
    return 'failed'
  }
}

/**
 * Run the check behind the response that created the lead, so creation stays
 * quick and nothing here can fail it.
 */
export function scheduleConflictCheck(leadId: string): void {
  const run = async () => {
    try {
      await runConflictCheck({ leadId })
    } catch (error) {
      console.error('[conflicts] check failed', { leadId, cause: error instanceof Error ? error.message : String(error) })
    }
  }
  try {
    after(run)
  } catch {
    // Outside a request scope (tests, scripts) there is no "after"; run inline.
    void run()
  }
}

/** Refuse to hire a lead the attorney has marked as a conflict. Tolerant of a missing table. */
export async function conflictBlocksHire(leadId: string, admin: Admin = getAdminClient()): Promise<string | null> {
  const state = await fetchLatestConflictCheck(leadId, admin).catch(() => null)
  if (state?.decision === 'conflict') {
    return 'A conflict of interest is recorded on this lead. Clear it on the lead page before opening a matter.'
  }
  return null
}
