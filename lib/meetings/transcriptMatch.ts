/**
 * Which matter or lead a meeting belongs to, from who was in it and when.
 *
 * The question has to be answered without a person: the sweep runs every half
 * hour and nobody is there to pick the record. So it answers only when the
 * answer is unambiguous, and otherwise says so. A wrong match would put a
 * client's transcript on another client's file, which is far worse than a
 * meeting that waits for a hand.
 *
 * Order of evidence:
 *   1. an appointment on the firm's calendar with one of the attendees, at
 *      about the same time, that is linked to a matter or lead;
 *   2. exactly one open matter whose client has one of the attendee emails;
 *   3. exactly one active lead with one of the attendee emails.
 */

export interface MatchableAppointment {
  id: string
  startIso: string
  attendeeEmails: string[]
  matterId: string | null
  leadId: string | null
  label: string | null
}

export interface MatchableRecord {
  id: string
  email: string
  name: string | null
}

export type MeetingRecordMatch =
  | { kind: 'matter'; id: string; name: string | null; via: 'appointment' | 'email' }
  | { kind: 'lead'; id: string; name: string | null; via: 'appointment' | 'email' }
  | { kind: 'none'; reason: 'no_attendees' | 'no_match' | 'ambiguous' }

/** How far apart a note's start and an appointment's start may be and still be the same meeting. */
const APPOINTMENT_WINDOW_MS = 12 * 60 * 60 * 1000

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null
}

/** Attendee strings as the Granola client formats them ("Name <email>") or bare emails. */
export function attendeeEmailsFrom(values: readonly string[]): string[] {
  const out = new Set<string>()
  for (const value of values) {
    const angle = value.match(/<([^>]+)>/)
    const email = normalizeEmail(angle ? angle[1] : value)
    if (email) out.add(email)
  }
  return [...out]
}

export function matchMeetingToRecord(input: {
  attendeeEmails: readonly string[]
  startIso: string | null
  appointments: readonly MatchableAppointment[]
  matters: readonly MatchableRecord[]
  leads: readonly MatchableRecord[]
  /** The firm's own addresses and domains, which never identify a client. */
  staffEmails: readonly string[]
  staffDomains?: readonly string[]
}): MeetingRecordMatch {
  const staff = new Set(input.staffEmails.map(email => email.toLowerCase()))
  const domains = (input.staffDomains ?? []).map(domain => domain.toLowerCase())
  const attendees = [...new Set(input.attendeeEmails
    .map(normalizeEmail)
    .filter((email): email is string => Boolean(email))
    .filter(email => !staff.has(email) && !domains.some(domain => email.endsWith(`@${domain}`))))]
  if (!attendees.length) return { kind: 'none', reason: 'no_attendees' }

  const startMs = input.startIso ? Date.parse(input.startIso) : NaN
  if (Number.isFinite(startMs)) {
    const nearby = input.appointments.filter(appointment => {
      const appointmentMs = Date.parse(appointment.startIso)
      if (!Number.isFinite(appointmentMs) || Math.abs(appointmentMs - startMs) > APPOINTMENT_WINDOW_MS) return false
      if (!appointment.matterId && !appointment.leadId) return false
      return appointment.attendeeEmails.some(email => attendees.includes(email.toLowerCase()))
    })
    const targets = new Set(nearby.map(appointment => appointment.matterId ? `matter:${appointment.matterId}` : `lead:${appointment.leadId}`))
    if (targets.size > 1) return { kind: 'none', reason: 'ambiguous' }
    if (nearby.length === 1 || targets.size === 1) {
      const appointment = nearby[0]
      return appointment.matterId
        ? { kind: 'matter', id: appointment.matterId, name: appointment.label, via: 'appointment' }
        : { kind: 'lead', id: appointment.leadId!, name: appointment.label, via: 'appointment' }
    }
  }

  const matters = uniqueById(input.matters.filter(record => attendees.includes(record.email.toLowerCase())))
  if (matters.length > 1) return { kind: 'none', reason: 'ambiguous' }
  if (matters.length === 1) return { kind: 'matter', id: matters[0].id, name: matters[0].name, via: 'email' }

  const leads = uniqueById(input.leads.filter(record => attendees.includes(record.email.toLowerCase())))
  if (leads.length > 1) return { kind: 'none', reason: 'ambiguous' }
  if (leads.length === 1) return { kind: 'lead', id: leads[0].id, name: leads[0].name, via: 'email' }

  return { kind: 'none', reason: 'no_match' }
}

function uniqueById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>()
  return rows.filter(row => (seen.has(row.id) ? false : (seen.add(row.id), true)))
}
