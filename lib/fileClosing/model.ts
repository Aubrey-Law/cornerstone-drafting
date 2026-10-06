/**
 * File closing and retention: the pure half.
 *
 * When a matter closes, three things follow from the record alone: the day
 * the firm's retention period ends, the notice the client should receive,
 * and whether a closed file is now due for a retention review. This module
 * holds those rules; server.ts reads and writes the records around them.
 *
 * Dates are `YYYY-MM-DD` keys in the firm's calendar.
 */

export interface FileClosingSettings {
  /** How many years after closing the file is kept before review. */
  retentionYears: number
  /** Whether closing a matter offers the client a closing notice through the dial. */
  closingNoticeEnabled: boolean
}

export const DEFAULT_FILE_CLOSING_SETTINGS: FileClosingSettings = {
  retentionYears: 6,
  closingNoticeEnabled: true,
}

function parseKey(key: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(key)
  if (!match) return null
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) }
}

/** `YYYY-MM-DD` plus whole years, Feb 29 landing on Feb 28 in a common year. */
export function addYears(key: string, years: number): string | null {
  const parts = parseKey(key)
  if (!parts) return null
  const target = new Date(Date.UTC(parts.y + years, parts.m - 1, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(parts.d, lastDay))
  return target.toISOString().slice(0, 10)
}

/** The day the retention period ends for a matter closed on `closedOn`. */
export function retentionUntil(closedOn: string, settings: Pick<FileClosingSettings, 'retentionYears'>): string | null {
  return addYears(closedOn.slice(0, 10), settings.retentionYears)
}

/** A `YYYY-MM-DD` key as "Jan 15, 2033", without the zone shift a timestamp formatter applies. */
export function formatDateKey(key: string): string {
  const parts = parseKey(key)
  if (!parts) return key
  return new Date(Date.UTC(parts.y, parts.m - 1, parts.d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

export interface RetentionCandidate {
  matterId: string
  matterName: string
  clientName: string | null
  status: string | null
  stage: string | null
  closedOn: string | null
  retentionUntil: string | null
  hold: boolean
  holdReason: string | null
}

export type RetentionState = 'open' | 'retained' | 'held' | 'due'

/**
 * Where a file stands: still an open matter, closed and within its period,
 * closed and held past it, or closed with the period ended and no hold.
 */
export function retentionState(candidate: Pick<RetentionCandidate, 'status' | 'stage' | 'retentionUntil' | 'hold'>, todayKey: string): RetentionState {
  const closed = candidate.status === 'closed' || candidate.status === 'archived' || candidate.stage === 'closed'
  if (!closed) return 'open'
  if (candidate.hold) return 'held'
  if (!candidate.retentionUntil || candidate.retentionUntil > todayKey) return 'retained'
  return 'due'
}

export function selectRetentionReview(candidates: readonly RetentionCandidate[], todayKey: string): {
  due: RetentionCandidate[]
  held: RetentionCandidate[]
  retained: RetentionCandidate[]
} {
  const due: RetentionCandidate[] = []
  const held: RetentionCandidate[] = []
  const retained: RetentionCandidate[] = []
  for (const candidate of candidates) {
    const state = retentionState(candidate, todayKey)
    if (state === 'due') due.push(candidate)
    else if (state === 'held') held.push(candidate)
    else if (state === 'retained') retained.push(candidate)
  }
  const byDate = (a: RetentionCandidate, b: RetentionCandidate) => (a.retentionUntil ?? '').localeCompare(b.retentionUntil ?? '')
  due.sort(byDate)
  held.sort(byDate)
  retained.sort(byDate)
  return { due, held, retained }
}

/** The task the weekly run proposes for a file past its date. */
export function retentionReviewTask(candidate: RetentionCandidate, settings: Pick<FileClosingSettings, 'retentionYears'>): { title: string; description: string } {
  const who = candidate.clientName ?? candidate.matterName
  const ended = candidate.retentionUntil ? formatDateKey(candidate.retentionUntil) : 'now'
  return {
    title: `File retention review: ${who}`,
    description: [
      `The ${settings.retentionYears}-year retention period for this file ended ${ended}.`,
      'Decide whether to destroy the file (Settings → Workflow → File closing lists it with a Destroy action, which logs to the deletion record) or to place it on hold with a reason.',
      'A client who asked for their documents should receive them before the file is destroyed.',
    ].join(' '),
  }
}

export interface ClosingNoticeInput {
  firstName: string | null
  firmName: string
  attorneyShortName: string
  /** What the engagement was for, in the client's words where possible ("your estate plan"). */
  planDescription: string
  hasPortalAccount: boolean
  portalUrl: string | null
  /** Whether the firm will reach out for annual reviews (campaign on and the client not opted out). */
  annualReviews: boolean
  retentionYears: number
  retentionUntil: string | null
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** The closing notice: the work is done, where the documents live, what to keep, what happens to the file. */
export function composeClosingNotice(input: ClosingNoticeInput): { subject: string; text: string; html: string } {
  const greeting = input.firstName ? `Hi ${input.firstName},` : 'Hello,'
  // "your estate plan" → "Your estate plan is complete"; "the estate administration" → "The estate administration is complete".
  const subject = `${input.planDescription.charAt(0).toUpperCase()}${input.planDescription.slice(1)} is complete`
  const until = input.retentionUntil ? formatDateKey(input.retentionUntil) : null

  const paragraphs = [
    greeting,
    `Our work on ${input.planDescription} is complete, and ${input.firmName} has closed your file. Thank you for trusting us with it.`,
    `Keep your signed originals somewhere safe and tell the people you named (your trustee, personal representative, agents and health care proxy) where to find them. A plan nobody can find does not help anyone.`,
    input.hasPortalAccount && input.portalUrl
      ? `Copies of your documents stay available in your portal, and you can still write to us there:\n${input.portalUrl}`
      : `Copies of your documents are in your file with us. Write or call any time you need one.`,
    input.annualReviews
      ? `Lives change, and a plan should change with them. We will check in with you about a year from now to see whether anything needs a second look. If something changes sooner (a marriage, a birth, a move, a new account or home), do not wait for us.`
      : `Lives change, and a plan should change with them. If something changes (a marriage, a birth, a move, a new account or home), please get in touch so we can look at whether your plan still fits.`,
    until
      ? `We keep a copy of your file for at least ${input.retentionYears} years after closing, until ${until}. After that it may be securely destroyed under our records policy. If you would like your file before then, just ask.`
      : `We keep a copy of your file for at least ${input.retentionYears} years after closing. After that it may be securely destroyed under our records policy. If you would like your file before then, just ask.`,
    `Warm regards,\n${input.attorneyShortName}\n${input.firmName}`,
  ]

  const text = paragraphs.join('\n\n')
  const html = `<div style="font-family:sans-serif;font-size:14px;line-height:1.5;color:#222">${paragraphs.map(paragraph => {
    const escaped = escapeHtml(paragraph).replace(/\n/g, '<br/>')
    const linked = input.portalUrl ? escaped.replace(escapeHtml(input.portalUrl), `<a href="${escapeHtml(input.portalUrl)}" style="color:#1a6b72">${escapeHtml(input.portalUrl)}</a>`) : escaped
    return `<p style="margin:0 0 1em 0">${linked}</p>`
  }).join('')}</div>`

  return { subject, text, html }
}

/** "your estate plan", "your trust", "the probate of the estate" from the practice area and plan type. */
export function describePlan(practiceArea: string | null, planType: string | null): string {
  if (practiceArea && ['PB', 'probate'].includes(practiceArea)) return 'the estate administration'
  const plan = (planType ?? '').toLowerCase()
  if (plan.includes('trust')) return 'your trust-based estate plan'
  if (plan.includes('will')) return 'your will-based estate plan'
  return 'your estate plan'
}

/** The four settings as the row holds them, with defaults where a column is null or absent. */
export function settingsFromRow(row: Record<string, unknown> | null | undefined): FileClosingSettings {
  const years = row?.file_retention_years
  return {
    retentionYears: typeof years === 'number' && Number.isFinite(years) ? years : DEFAULT_FILE_CLOSING_SETTINGS.retentionYears,
    closingNoticeEnabled: row?.closing_notice_enabled !== false,
  }
}

/** A settings patch from a request body, checked. Throws with a sentence the form can show. */
export function parseSettingsPatch(value: unknown): Partial<FileClosingSettings> {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const patch: Partial<FileClosingSettings> = {}
  if ('closingNoticeEnabled' in input) {
    if (typeof input.closingNoticeEnabled !== 'boolean') throw new Error('closingNoticeEnabled must be true or false')
    patch.closingNoticeEnabled = input.closingNoticeEnabled
  }
  if ('retentionYears' in input) {
    const raw = input.retentionYears
    const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : raw
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 30) throw new Error('Retention years must be a whole number between 1 and 30')
    patch.retentionYears = n
  }
  return patch
}

/** One line for the card on Today and the digest. */
export function closingNoticeSummary(clientName: string | null, toEmail: string): string {
  return `Send the closing notice to ${clientName ?? toEmail}`
}
