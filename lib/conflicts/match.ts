/**
 * Conflict-of-interest matching: the pure half.
 *
 * A new lead is searched against the people the firm already knows: clients
 * and former clients, their spouses, the beneficiaries and fiduciaries named on
 * their plans, and other leads. This module decides what counts as a match and
 * how strong it is. Email and phone are identities, so an exact match is
 * strong. A name is weaker: the same full name is strong, the same surname
 * with the same first initial is possible, a surname alone is nothing (half
 * the county shares one). Every rule is a table in a test.
 *
 * It never decides whether a conflict exists. That is the attorney's call;
 * this finds the records they must look at.
 */

export type MatchedOn = 'email' | 'phone' | 'name' | 'surname'
export type MatchStrength = 'strong' | 'possible'
export type CandidateKind = 'lead' | 'matter' | 'contact'

/** Who is being checked: every way the lead (and their spouse) could appear in the records. */
export interface ConflictSubject {
  names: string[]
  emails: string[]
  phones: string[]
}

/** A record the subject is compared against. */
export interface ConflictCandidate {
  kind: CandidateKind
  id: string
  /** The person's name as the record holds it. */
  label: string
  /** Where they appear: "Client · Smith Estate Plan", "Spouse of Pat Smith", "Trustee · Jones Trust". */
  context: string
  href: string
  names: string[]
  emails: string[]
  phones: string[]
}

export interface ConflictHit extends Omit<ConflictCandidate, 'names' | 'emails' | 'phones'> {
  matchedOn: MatchedOn[]
  strength: MatchStrength
  /** The subject value that matched, for the attorney to see at a glance. */
  matchedValue: string
}

export type ConflictResult = 'clear' | 'possible'
export type ConflictDecision = 'pending' | 'no_conflict' | 'conflict'

export interface ConflictCheckState {
  id: string
  result: ConflictResult
  decision: ConflictDecision
  hits: ConflictHit[]
  checkedAt: string
  decidedAt: string | null
  note: string | null
}

export function normaliseEmail(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

/** The last ten digits, so "+1 (617) 555-0100" and "617.555.0100" agree. */
export function normalisePhone(value: string | null | undefined): string {
  const digits = (value ?? '').replace(/\D/g, '')
  return digits.length > 10 ? digits.slice(-10) : digits
}

const NAME_NOISE = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'mr', 'mrs', 'ms', 'dr', 'esq'])

/** Lower-case word tokens with punctuation and suffixes removed: "O'Brien, Jr." → ["obrien"]. */
export function nameTokens(value: string | null | undefined): string[] {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    // An apostrophe or a dot joins what it sits between (O'Brien, St.John);
    // anything else that is not a letter separates.
    .replace(/['’.]/g, '')
    .replace(/[^a-z\s-]/g, ' ')
    .replace(/-/g, ' ')
    .split(/\s+/)
    // Single letters stay: "P. O'Brien" is an initial, and the initial is
    // exactly what the surname rule compares.
    .filter(token => token.length > 0 && !NAME_NOISE.has(token))
}

/** "pat smith" from any spelling, or '' when there is no usable name. */
export function normaliseName(value: string | null | undefined): string {
  return nameTokens(value).join(' ')
}

function surname(tokens: string[]): string | null {
  return tokens.length >= 2 ? tokens[tokens.length - 1] : null
}

function given(tokens: string[]): string | null {
  return tokens.length >= 2 ? tokens[0] : null
}

/** Trim, drop blanks and duplicates, keep order. */
export function distinct(values: ReadonlyArray<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const trimmed = (value ?? '').trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

/**
 * Compare one subject with one candidate. Null when nothing lines up.
 *
 * A single email or phone in common is strong on its own. Names: the same
 * normalised full name is strong; the same surname and first initial is
 * possible (Pat Smith against P. Smith, Patrick Smith); surname alone is not
 * a match. A possible name match plus a strong identity match reads as strong.
 */
export function matchCandidate(subject: ConflictSubject, candidate: ConflictCandidate): ConflictHit | null {
  const matchedOn: MatchedOn[] = []
  let matchedValue = ''

  const subjectEmails = new Set(subject.emails.map(normaliseEmail).filter(Boolean))
  for (const email of candidate.emails) {
    const normalised = normaliseEmail(email)
    if (normalised && subjectEmails.has(normalised)) {
      matchedOn.push('email')
      matchedValue = matchedValue || email.trim()
      break
    }
  }

  const subjectPhones = new Set(subject.phones.map(normalisePhone).filter(phone => phone.length >= 7))
  for (const phone of candidate.phones) {
    const normalised = normalisePhone(phone)
    if (normalised.length >= 7 && subjectPhones.has(normalised)) {
      matchedOn.push('phone')
      matchedValue = matchedValue || phone.trim()
      break
    }
  }

  let nameStrength: MatchStrength | null = null
  const subjectNames = subject.names.map(nameTokens).filter(tokens => tokens.length > 0)
  outer: for (const candidateName of candidate.names) {
    const tokens = nameTokens(candidateName)
    if (tokens.length === 0) continue
    for (const own of subjectNames) {
      if (own.join(' ') === tokens.join(' ')) {
        nameStrength = 'strong'
        matchedValue = matchedValue || candidateName.trim()
        break outer
      }
      const ownSurname = surname(own)
      const theirSurname = surname(tokens)
      const ownGiven = given(own)
      const theirGiven = given(tokens)
      if (ownSurname && theirSurname && ownSurname === theirSurname && ownGiven && theirGiven && ownGiven[0] === theirGiven[0]) {
        nameStrength = nameStrength ?? 'possible'
        matchedValue = matchedValue || candidateName.trim()
      }
    }
  }
  if (nameStrength) matchedOn.push(nameStrength === 'strong' ? 'name' : 'surname')

  if (matchedOn.length === 0) return null
  const strength: MatchStrength = matchedOn.includes('email') || matchedOn.includes('phone') || nameStrength === 'strong'
    ? 'strong'
    : 'possible'
  return {
    kind: candidate.kind,
    id: candidate.id,
    label: candidate.label,
    context: candidate.context,
    href: candidate.href,
    matchedOn,
    strength,
    matchedValue,
  }
}

/** Every hit, strongest first, one per record. */
export function findConflicts(subject: ConflictSubject, candidates: readonly ConflictCandidate[]): ConflictHit[] {
  const hits: ConflictHit[] = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    const key = `${candidate.kind}:${candidate.id}`
    if (seen.has(key)) continue
    const hit = matchCandidate(subject, candidate)
    if (!hit) continue
    seen.add(key)
    hits.push(hit)
  }
  return hits.sort((a, b) => Number(b.strength === 'strong') - Number(a.strength === 'strong') || a.label.localeCompare(b.label))
}

export function conflictResult(hits: readonly ConflictHit[]): ConflictResult {
  return hits.length === 0 ? 'clear' : 'possible'
}

/** A fingerprint of the hits, so the same findings are not raised twice. */
export function conflictDigest(hits: readonly ConflictHit[]): string {
  return hits.map(hit => `${hit.kind}:${hit.id}:${hit.matchedOn.join('+')}`).sort().join('|') || 'clear'
}

/** The lifecycle reads the check as satisfied only when nothing stands in the way. */
export function conflictCheckSatisfied(state: Pick<ConflictCheckState, 'result' | 'decision'> | null | undefined): boolean {
  if (!state) return false
  if (state.decision === 'conflict') return false
  if (state.decision === 'no_conflict') return true
  return state.result === 'clear'
}

export const MATCHED_ON_LABELS: Record<MatchedOn, string> = {
  email: 'same email',
  phone: 'same phone',
  name: 'same name',
  surname: 'same surname and initial',
}

export const KIND_LABELS: Record<CandidateKind, string> = {
  lead: 'Lead',
  matter: 'Client',
  contact: 'Person on a matter',
}

/** One line for the card and the task: "2 possible matches, 1 strong". */
export function describeConflictCheck(state: ConflictCheckState | null): string {
  if (!state) return 'Not checked yet.'
  if (state.decision === 'conflict') return 'Conflict recorded. Do not engage without clearing it.'
  if (state.result === 'clear') return 'No matches in the firm’s records.'
  const strong = state.hits.filter(hit => hit.strength === 'strong').length
  const count = state.hits.length
  const base = `${count} possible ${count === 1 ? 'match' : 'matches'}${strong > 0 ? `, ${strong} strong` : ''}`
  return state.decision === 'no_conflict' ? `${base} · reviewed, no conflict.` : `${base} · needs your review.`
}
