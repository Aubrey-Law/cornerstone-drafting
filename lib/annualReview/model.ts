/**
 * Annual review outreach: the pure half.
 *
 * A signed estate plan goes stale as life changes, and the firm only learns
 * of a marriage, a birth, a move or a new account if it asks. This module
 * decides who is due to be asked and when, and writes the asking. The server
 * half (server.ts) reads the records, drafts, and offers the send through the
 * delegation dial.
 *
 * Every date here is a `YYYY-MM-DD` key in the firm's calendar, so month
 * arithmetic cannot drift with the runtime's zone.
 */

export interface AnnualReviewSettings {
  enabled: boolean
  /** Months after the plan is signed before the first review. */
  monthsAfterSigning: number
  /** Months between reviews after the first. */
  cadenceMonths: number
  /** How many days before the due date the outreach goes out. */
  leadDays: number
}

export const DEFAULT_ANNUAL_REVIEW_SETTINGS: AnnualReviewSettings = {
  enabled: false,
  monthsAfterSigning: 12,
  cadenceMonths: 12,
  leadDays: 14,
}

/** Stages at which the plan is signed and a review makes sense. */
export const REVIEWABLE_STAGES = new Set(['signing_complete', 'post_execution', 'funding', 'closed'])

export interface AnnualReviewCandidate {
  matterId: string
  matterName: string
  clientName: string
  clientFirstName: string | null
  clientEmail: string | null
  /** The day the plan was signed, as the record holds it; null when unknown. */
  anchorOn: string | null
  stage: string | null
  status: string | null
  practiceArea: string | null
  optedOut: boolean
  /** The newest cycle already drafted or sent for this matter, if any. */
  lastCycleDueOn: string | null
  hasPortalAccount: boolean
}

export type SkipReason = 'opted_out' | 'no_anchor' | 'no_email' | 'not_signed' | 'not_estate_planning' | 'archived' | 'not_due'

const DAY_MS = 86_400_000

/**
 * When the campaign is switched on, a plan whose anniversary passed this
 * many days ago (or less) is still asked for that review; an older one waits
 * for its next anniversary rather than getting a stale invitation.
 */
export const CATCH_UP_GRACE_DAYS = 60

function parseKey(key: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(key)
  if (!match) return null
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) }
}

function toKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** `YYYY-MM-DD` plus whole months, with the day clamped to the target month's length (Jan 31 + 1 → Feb 28). */
export function addMonths(key: string, months: number): string | null {
  const parts = parseKey(key)
  if (!parts) return null
  const target = new Date(Date.UTC(parts.y, parts.m - 1 + months, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(parts.d, lastDay))
  return toKey(target)
}

export function addDays(key: string, days: number): string | null {
  const parts = parseKey(key)
  if (!parts) return null
  return toKey(new Date(Date.UTC(parts.y, parts.m - 1, parts.d) + days * DAY_MS))
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number | null {
  const a = parseKey(from)
  const b = parseKey(to)
  if (!a || !b) return null
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / DAY_MS)
}

/**
 * The next review due date: the first is the anchor plus the configured
 * months; after one has been drafted or sent, each cadence after that one.
 * Catches up a plan signed long ago by stepping forward until the due date is
 * after the last cycle, never asking for reviews already missed.
 */
export function nextReviewDueOn(candidate: Pick<AnnualReviewCandidate, 'anchorOn' | 'lastCycleDueOn'>, settings: AnnualReviewSettings, todayKey: string): string | null {
  if (!candidate.anchorOn) return null
  let due = addMonths(candidate.anchorOn.slice(0, 10), settings.monthsAfterSigning)
  if (!due) return null
  const floor = candidate.lastCycleDueOn ?? addDays(todayKey, -settings.leadDays - CATCH_UP_GRACE_DAYS)
  // A plan signed years ago gets its next review, not every one it missed.
  let guard = 0
  while (floor && due <= floor && guard < 120) {
    due = addMonths(due, settings.cadenceMonths)
    if (!due) return null
    guard += 1
  }
  return due
}

export type OutreachDecision =
  | { due: true; dueOn: string; yearsSinceSigning: number }
  | { due: false; reason: SkipReason; dueOn: string | null }

/** Whether this matter should be asked today, and for which review. */
export function decideOutreach(candidate: AnnualReviewCandidate, settings: AnnualReviewSettings, todayKey: string): OutreachDecision {
  if (candidate.status === 'archived') return { due: false, reason: 'archived', dueOn: null }
  if (candidate.optedOut) return { due: false, reason: 'opted_out', dueOn: null }
  if (candidate.practiceArea && !['EP', 'estate_planning', 'estate-planning'].includes(candidate.practiceArea)) {
    return { due: false, reason: 'not_estate_planning', dueOn: null }
  }
  if (!candidate.anchorOn) return { due: false, reason: 'no_anchor', dueOn: null }
  const signed = candidate.status === 'closed' || (candidate.stage !== null && REVIEWABLE_STAGES.has(candidate.stage))
  if (!signed) return { due: false, reason: 'not_signed', dueOn: null }
  if (!candidate.clientEmail?.trim()) return { due: false, reason: 'no_email', dueOn: null }
  const dueOn = nextReviewDueOn(candidate, settings, todayKey)
  if (!dueOn) return { due: false, reason: 'no_anchor', dueOn: null }
  const daysUntil = daysBetween(todayKey, dueOn) ?? Number.POSITIVE_INFINITY
  if (daysUntil > settings.leadDays) return { due: false, reason: 'not_due', dueOn }
  const years = Math.max(1, Math.round((daysBetween(candidate.anchorOn.slice(0, 10), dueOn) ?? 365) / 365))
  return { due: true, dueOn, yearsSinceSigning: years }
}

export interface OutreachSelection {
  due: Array<{ candidate: AnnualReviewCandidate; dueOn: string; yearsSinceSigning: number }>
  skipped: Array<{ matterId: string; reason: SkipReason }>
}

export function selectOutreach(candidates: readonly AnnualReviewCandidate[], settings: AnnualReviewSettings, todayKey: string): OutreachSelection {
  const selection: OutreachSelection = { due: [], skipped: [] }
  for (const candidate of candidates) {
    const decision = decideOutreach(candidate, settings, todayKey)
    if (decision.due) selection.due.push({ candidate, dueOn: decision.dueOn, yearsSinceSigning: decision.yearsSinceSigning })
    else selection.skipped.push({ matterId: candidate.matterId, reason: decision.reason })
  }
  return selection
}

export interface ReviewEmailInput {
  firstName: string | null
  firmName: string
  attorneyShortName: string
  yearsSinceSigning: number
  bookingUrl: string | null
  bookingLabel: string | null
  portalUrl: string | null
}

const LIFE_CHANGES = [
  'a marriage, divorce or new partner',
  'a birth or adoption, or a child who has turned 18',
  'a move, or a new home or other real estate',
  'a new account, business interest or inheritance',
  'a death or illness among the people your plan names',
]

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** The email, as text and as matching HTML. Warm, short, one ask. */
export function composeReviewEmail(input: ReviewEmailInput): { subject: string; text: string; html: string } {
  const years = input.yearsSinceSigning
  const since = years <= 1 ? 'a year' : `${years} years`
  const greeting = input.firstName ? `Hi ${input.firstName},` : 'Hello,'
  const subject = years <= 1
    ? `Your estate plan is a year old. Time for a quick review?`
    : `Time for a quick review of your estate plan`

  const paragraphs = [
    greeting,
    `It has been about ${since} since you signed your estate plan with ${input.firmName}. Plans do not go out of date on their own, but lives change, and a plan that no longer matches your life can fail the people it was written for.`,
    `If any of these happened since you signed, your plan should be looked at:`,
    LIFE_CHANGES.map(item => `- ${item}`).join('\n'),
    input.bookingUrl
      ? `A short review call is enough to catch most of it. Book a time that suits you:\n${input.bookingUrl}`
      : `A short review call is enough to catch most of it. Reply to this email and we will find a time.`,
    `If nothing has changed, a one-line reply saying so is all we need, and we will check in again next year.`,
    input.portalUrl ? `Your signed documents are always in your portal:\n${input.portalUrl}` : null,
    `Warm regards,\n${input.attorneyShortName}\n${input.firmName}`,
  ].filter((paragraph): paragraph is string => Boolean(paragraph))

  const text = paragraphs.join('\n\n')

  const htmlParagraphs = paragraphs.map(paragraph => {
    if (paragraph.startsWith('- ')) {
      const items = paragraph.split('\n').map(line => `<li>${escapeHtml(line.replace(/^- /, ''))}</li>`).join('')
      return `<ul style="margin:0 0 0 1.2em;padding:0">${items}</ul>`
    }
    const escaped = escapeHtml(paragraph).replace(/\n/g, '<br/>')
    const linked = [input.bookingUrl, input.portalUrl].filter((url): url is string => Boolean(url)).reduce(
      (acc, url) => acc.replace(escapeHtml(url), `<a href="${escapeHtml(url)}" style="color:#1a6b72">${escapeHtml(url)}</a>`),
      escaped,
    )
    return `<p style="margin:0 0 1em 0">${linked}</p>`
  })
  const html = `<div style="font-family:sans-serif;font-size:14px;line-height:1.5;color:#222">${htmlParagraphs.join('')}</div>`

  return { subject, text, html }
}

export interface OutreachRow {
  id: string
  matterId: string
  cycleDueOn: string
  status: 'drafted' | 'sent' | 'skipped' | 'failed'
  toEmail: string
  subject: string
  sentAt: string | null
}

/** Who the next run would ask, as the Settings page shows it. */
export interface OutreachPreview {
  enabled: boolean
  today: string
  settings: AnnualReviewSettings
  /** True when the outreach table is not in the database yet. */
  unavailable: boolean
  candidates: number
  due: Array<{ matterId: string; matterName: string; clientName: string; clientEmail: string | null; dueOn: string; yearsSinceSigning: number }>
  skipped: Partial<Record<SkipReason, number>>
  recent: Array<{ id: string; matterId: string; matterName: string | null; cycleDueOn: string; status: string; toEmail: string; sentAt: string | null; createdAt: string }>
}

/** A `YYYY-MM-DD` key as "Jan 15, 2027", without the zone shift a timestamp formatter would apply. */
export function formatDateKey(key: string): string {
  const parts = parseKey(key)
  if (!parts) return key
  return new Date(Date.UTC(parts.y, parts.m - 1, parts.d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

/** One line for the card on Today and the digest. */
export function outreachSummary(row: Pick<OutreachRow, 'toEmail' | 'cycleDueOn'>, clientName: string | null): string {
  return `Send the annual review invitation to ${clientName ?? row.toEmail} (review due ${formatDateKey(row.cycleDueOn)})`
}

/** The four settings as the row holds them, with defaults where a column is null or absent. */
export function settingsFromRow(row: Record<string, unknown> | null | undefined): AnnualReviewSettings {
  const number = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return {
    enabled: row?.annual_review_outreach_enabled === true,
    monthsAfterSigning: number(row?.annual_review_months_after_signing, DEFAULT_ANNUAL_REVIEW_SETTINGS.monthsAfterSigning),
    cadenceMonths: number(row?.annual_review_cadence_months, DEFAULT_ANNUAL_REVIEW_SETTINGS.cadenceMonths),
    leadDays: number(row?.annual_review_lead_days, DEFAULT_ANNUAL_REVIEW_SETTINGS.leadDays),
  }
}

/** A settings patch from a request body, checked. Throws with a sentence the form can show. */
export function parseSettingsPatch(value: unknown): Partial<AnnualReviewSettings> {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const patch: Partial<AnnualReviewSettings> = {}
  if ('enabled' in input) {
    if (typeof input.enabled !== 'boolean') throw new Error('enabled must be true or false')
    patch.enabled = input.enabled
  }
  const integer = (key: keyof AnnualReviewSettings, min: number, max: number, label: string) => {
    if (!(key in input)) return
    const raw = input[key]
    const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : raw
    if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) throw new Error(`${label} must be a whole number between ${min} and ${max}`)
    ;(patch as Record<string, unknown>)[key] = n
  }
  integer('monthsAfterSigning', 1, 60, 'Months after signing')
  integer('cadenceMonths', 1, 60, 'Months between reviews')
  integer('leadDays', 0, 120, 'Days of notice')
  return patch
}
