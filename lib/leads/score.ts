/**
 * Lead scoring. A deterministic 0-100 estimate of how likely a lead is to hire
 * the firm, derived only from values already on the lead row so no new API
 * surface or stored column is required.
 *
 * This is deliberately not readiness (`lib/leads/readiness.ts`), which measures
 * how complete the record is, nor next action (`lib/leads/nextAction.ts`), which
 * says what to do next. Scoring answers who to work first.
 *
 * Every component degrades to zero points with a stated reason when its input is
 * missing, so a sparse lead scores low rather than producing a partial score the
 * reader cannot account for.
 */
import { calendarDayDifference, FIRM_TIMEZONE } from '@/lib/utils'
import type { LeadEditableField } from '@/lib/leads/details'
import type { LeadDetailRecord, LeadListRow } from '@/lib/leads/viewTypes'

export type LeadScoreBand = 'hot' | 'warm' | 'cool' | 'cold'

export type LeadScoreComponentKey =
  | 'progress'
  | 'fee'
  | 'estate'
  | 'urgency'
  | 'recency'
  | 'appointment'
  | 'source'
  | 'readiness'

export type LeadScoreComponent = {
  key: LeadScoreComponentKey
  label: string
  points: number
  /** Ceiling for this component; the maxima across all components sum to 100. */
  max: number
  reason: string
  /**
   * Whether the lead answered this question at all.
   *
   * A component scores 0 for two different reasons, and the band has to tell
   * them apart. "No intake sent yet" is an answer — the lead is at the start of
   * the funnel. "No fee quoted" is silence: pre-engagement, one lead in
   * thirty-five has a fee, so judging every other lead as though it failed that
   * test is what made `hot` unreachable.
   */
  available: boolean
}

export type LeadScore = {
  /** 0-100 across every component, whether or not the lead could answer it. */
  score: number
  /** The points on offer for the questions this lead did answer. */
  attainable: number
  /** `score` as a share of `attainable` — what the band reads. */
  percent: number
  band: LeadScoreBand
  components: LeadScoreComponent[]
}

export type LeadScoreInput = {
  leadStatus: string | null
  intakeSentAt: string | null
  intakeCompletedAt: string | null
  /** `client_intake.status` — the intake's own status column. */
  intakeStatus: string | null
  engagementStatus: string | null
  engagementSentAt: string | null
  engagementSignedAt: string | null
  feeQuoted: number | null
  billingType: string | null
  taxableEstate: number | null
  hasMinorChildren: boolean | null
  urgency: string | null
  leadSource: string | null
  lastTouchAt: string | null
  createdAt: string | null
  nextAppointmentAt: string | null
  /** `computeLeadReadiness().percent`, when the caller has computed it. */
  readinessPercent: number | null
  timeZone?: string
}

export const LEAD_SCORE_BANDS: { key: LeadScoreBand; label: string; min: number }[] = [
  { key: 'hot', label: 'Hot', min: 70 },
  { key: 'warm', label: 'Warm', min: 45 },
  { key: 'cool', label: 'Cool', min: 25 },
  { key: 'cold', label: 'Cold', min: 0 },
]

const LEGAL_PLAN_BILLING_TYPES = ['metlife', 'legalease', 'arag', 'clc', 'other_legal_plan']

/**
 * The band for a percentage. Kept on the 0-100 scale it always used, but what
 * is handed to it changed: `computeLeadScore()` now passes the share of the
 * points a lead could actually earn, not the share of all 100.
 */
export function leadScoreBand(score: number): LeadScoreBand {
  return LEAD_SCORE_BANDS.find(band => score >= band.min)?.key ?? 'cold'
}

export function leadScoreBandLabel(band: LeadScoreBand): string {
  return LEAD_SCORE_BANDS.find(entry => entry.key === band)?.label ?? 'Cold'
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function money(value: number | null): string {
  return `$${Math.round(value ?? 0).toLocaleString('en-US')}`
}

function progressComponent(input: LeadScoreInput): LeadScoreComponent {
  const max = 20
  const engagementStatus = text(input.engagementStatus)
  const intakeComplete = Boolean(input.intakeCompletedAt) || text(input.intakeStatus) === 'completed'

  // Always available: where a lead stands in the funnel is knowable even when
  // the answer is "nowhere yet".
  const at = (points: number, reason: string): LeadScoreComponent =>
    ({ key: 'progress', label: 'Pipeline progress', points, max, reason, available: true })

  if (input.engagementSignedAt || engagementStatus === 'signed') return at(max, 'Engagement agreement signed')
  if (input.engagementSentAt || engagementStatus === 'sent') return at(16, 'Engagement agreement sent')
  if (intakeComplete) return at(12, 'Intake completed')
  if (input.intakeSentAt) return at(6, 'Intake sent, awaiting the client')
  return at(0, 'No intake sent yet')
}

function feeComponent(input: LeadScoreInput): LeadScoreComponent {
  const max = 15
  const label = 'Revenue signal'
  const fee = input.feeQuoted

  if (fee !== null && fee > 0) {
    const points = fee >= 5000 ? 15 : fee >= 3000 ? 12 : fee >= 1500 ? 8 : 5
    return { key: 'fee', label, points, max, reason: `Fee quoted at ${money(fee)}`, available: true }
  }
  if (LEGAL_PLAN_BILLING_TYPES.includes(text(input.billingType))) {
    return { key: 'fee', label, points: 7, max, reason: 'Legal plan member — benefit covers the work', available: true }
  }
  // Unavailable rather than failed: the fee is quoted after the planning
  // session, so before it there is nothing to judge.
  return { key: 'fee', label, points: 0, max, reason: 'No fee quoted', available: false }
}

function estateComponent(input: LeadScoreInput): LeadScoreComponent {
  const max = 15
  const label = 'Estate complexity'
  const estate = input.taxableEstate
  const minorChildren = input.hasMinorChildren === true
  const bump = minorChildren ? 2 : 0

  if (estate !== null && estate > 0) {
    const base = estate >= 2_000_000 ? 15 : estate >= 1_000_000 ? 10 : 5
    const reason = estate >= 2_000_000
      ? `Estate of ${money(estate)} — above the MA estate tax threshold`
      : `Estate of ${money(estate)}`
    return {
      key: 'estate',
      label,
      points: Math.min(max, base + bump),
      max,
      reason: minorChildren ? `${reason}; minor children` : reason,
      available: true,
    }
  }
  if (minorChildren) {
    return { key: 'estate', label, points: bump, max, reason: 'Minor children; no estate value recorded', available: true }
  }
  return { key: 'estate', label, points: 0, max, reason: 'No estate value recorded', available: false }
}

function urgencyComponent(input: LeadScoreInput): LeadScoreComponent {
  const max = 10
  const label = 'Urgency'
  const urgency = text(input.urgency)
  if (urgency === 'high') return { key: 'urgency', label, points: 10, max, reason: 'Marked high urgency', available: true }
  if (urgency === 'normal') return { key: 'urgency', label, points: 5, max, reason: 'Normal urgency', available: true }
  if (urgency === 'low') return { key: 'urgency', label, points: 0, max, reason: 'Marked low urgency', available: true }
  return { key: 'urgency', label, points: 4, max, reason: 'Urgency not set', available: false }
}

function recencyComponent(input: LeadScoreInput, timeZone: string): LeadScoreComponent {
  const max = 15
  const label = 'Recent contact'
  const days = input.lastTouchAt
    ? calendarDayDifference(Date.now(), input.lastTouchAt, timeZone)
    : null

  if (days === null) return { key: 'recency', label, points: 0, max, reason: 'No recorded touch', available: false }

  const ago = days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`
  const points = days <= 3 ? 15 : days <= 7 ? 11 : days <= 14 ? 6 : days <= 30 ? 2 : 0
  const reason = days > 30 ? `Last touch ${ago} — gone cold` : `Last touch ${ago}`
  return { key: 'recency', label, points, max, reason, available: true }
}

function appointmentComponent(input: LeadScoreInput, timeZone: string): LeadScoreComponent {
  const max = 10
  const label = 'Meeting'
  // Always available: an empty calendar is an answer, not a gap in the record.
  if (!input.nextAppointmentAt) {
    return { key: 'appointment', label, points: 0, max, reason: 'No meeting on the calendar', available: true }
  }
  const days = calendarDayDifference(input.nextAppointmentAt, Date.now(), timeZone)
  if (days === null) {
    return { key: 'appointment', label, points: 0, max, reason: 'No meeting on the calendar', available: true }
  }
  return days >= 0
    ? { key: 'appointment', label, points: 10, max, available: true, reason: days === 0 ? 'Meeting scheduled today' : `Meeting scheduled in ${days} days` }
    : { key: 'appointment', label, points: 5, max, available: true, reason: `Met ${Math.abs(days)} days ago` }
}

function sourceComponent(input: LeadScoreInput): LeadScoreComponent {
  const max = 10
  const label = 'Lead source'
  const source = text(input.leadSource)

  if (!source) return { key: 'source', label, points: 2, max, reason: 'Source not recorded', available: false }
  if (source.includes('referral')) return { key: 'source', label, points: 10, max, reason: 'Referral', available: true }
  if (LEGAL_PLAN_BILLING_TYPES.some(plan => source.includes(plan))) {
    return { key: 'source', label, points: 8, max, reason: 'Legal plan referral', available: true }
  }
  if (['website', 'web', 'google'].some(term => source.includes(term))) {
    return { key: 'source', label, points: 5, max, reason: 'Inbound web search', available: true }
  }
  return { key: 'source', label, points: 4, max, reason: `Source: ${input.leadSource}`, available: true }
}

function readinessComponent(input: LeadScoreInput): LeadScoreComponent {
  const max = 5
  const label = 'Record readiness'
  const percent = input.readinessPercent
  if (percent === null || !Number.isFinite(percent)) {
    return { key: 'readiness', label, points: 0, max, reason: 'Readiness not computed', available: false }
  }
  const clamped = Math.min(100, Math.max(0, percent))
  return {
    key: 'readiness',
    label,
    points: Math.min(max, Math.round(clamped / 20)),
    max,
    reason: `Record ${Math.round(clamped)}% complete`,
    available: true,
  }
}

export function computeLeadScore(input: LeadScoreInput): LeadScore {
  const timeZone = input.timeZone ?? FIRM_TIMEZONE
  const components: LeadScoreComponent[] = [
    progressComponent(input),
    feeComponent(input),
    estateComponent(input),
    urgencyComponent(input),
    recencyComponent(input, timeZone),
    appointmentComponent(input, timeZone),
    sourceComponent(input),
    readinessComponent(input),
  ]

  const total = components.reduce((sum, component) => sum + component.points, 0)
  const score = Math.min(100, Math.max(0, total))

  /*
   * Banding against the whole 100 described a pipeline that does not exist.
   * Before the planning session a lead has no fee, usually no estate value, no
   * urgency and no readiness — 45 of the 100 points are for questions nobody
   * has asked yet — so the best real lead reached 63 and `hot` (70) was
   * unreachable. Judged instead on the questions it did answer, a lead that is
   * as far along as a lead gets reads as hot, which is the whole point of a
   * band.
   *
   * `score` is untouched: it is what the list orders by, and `lead_score()` in
   * SQL mirrors it (tests/lead-score-sql-parity.test.ts).
   */
  // Both sides of the fraction read the same components. An unanswered
  // question still contributes its hedge to `score` — urgency nobody set is
  // worth 4, an unrecorded source 2, because a blank is not a bad answer — but
  // counting those points against a denominator that excludes them would have
  // rated a lead with nothing recorded at 20%.
  const answered = components.filter(component => component.available)
  const attainable = answered.reduce((sum, component) => sum + component.max, 0)
  const earned = answered.reduce((sum, component) => sum + component.points, 0)
  const percent = attainable > 0 ? Math.round((earned / attainable) * 100) : 0

  return { score, attainable, percent, band: leadScoreBand(percent), components }
}

/** Components that earned points, richest first — the "why" behind a score. */
export function topLeadScoreReasons(score: LeadScore, limit = 3): LeadScoreComponent[] {
  return score.components
    .filter(component => component.points > 0)
    .sort((left, right) => right.points - left.points)
    .slice(0, limit)
}

/**
 * A lead that is hired, lost or declined is out of the running, so its score is
 * shown muted rather than as a live priority. Mirrors how `computeNextAction`
 * falls silent for those states.
 */
export function leadScoreIsActive(leadStatus: string | null | undefined): boolean {
  const status = text(leadStatus)
  return status === '' || status === 'lead'
}

/**
 * The meeting a lead's score should reflect: the soonest one still ahead, or
 * failing that the most recent one already held. Scoring credits a booked call
 * more than a past one, so which of the two anchors wins matters — and every
 * caller must pick the same way or the same lead scores differently by surface.
 */
export function scoringAppointmentAt(
  ...anchors: (string | null | undefined)[]
): string | null {
  const now = Date.now()
  const parsed = anchors
    .filter((value): value is string => Boolean(value))
    .map(value => ({ value, time: new Date(value).getTime() }))
    .filter(anchor => Number.isFinite(anchor.time))
  if (parsed.length === 0) return null

  const upcoming = parsed.filter(anchor => anchor.time >= now).sort((a, b) => a.time - b.time)
  if (upcoming.length > 0) return upcoming[0].value
  return parsed.sort((a, b) => b.time - a.time)[0].value
}

function numeric(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/**
 * Maps a list row or detail record onto the score input. `extras` carries values
 * the row itself does not hold — the detail page can supply readiness and an
 * appointment the list loader does not fetch.
 */
export function leadScoreInputFromRow(
  lead: LeadListRow | LeadDetailRecord,
  extras: {
    lastTouchAt?: string | null
    nextAppointmentAt?: string | null
    readinessPercent?: number | null
  } = {},
): LeadScoreInput {
  const row = lead as Record<string, unknown>
  return {
    leadStatus: nullableText(row.lead_status),
    intakeSentAt: nullableText(row.intake_sent_at),
    intakeCompletedAt: nullableText(row.intake_completed_at),
    intakeStatus: nullableText(row.status),
    engagementStatus: nullableText(row.engagement_status),
    engagementSentAt: nullableText(row.engagement_sent_at),
    engagementSignedAt: nullableText(row.engagement_signed_at),
    feeQuoted: numeric(row.engagement_fee_quoted),
    billingType: nullableText(row.billing_type),
    taxableEstate: numeric(row.taxable_estate),
    hasMinorChildren: typeof row.has_minor_children === 'boolean' ? row.has_minor_children : null,
    urgency: nullableText(row.lead_urgency),
    leadSource: nullableText(row.lead_source),
    lastTouchAt: extras.lastTouchAt ?? nullableText(row.last_activity_at) ?? nullableText(row.updated_at),
    createdAt: nullableText(row.created_at),
    nextAppointmentAt: extras.nextAppointmentAt ?? nullableText(row.next_appointment_at),
    readinessPercent: extras.readinessPercent ?? null,
  }
}

/**
 * A question nobody has asked this lead yet, and the one move that answers it.
 *
 * These are the components scored `available: false` — points the lead cannot
 * earn until someone fills a field. Across the 35 open leads when this was
 * written, 34 had no fee quoted, 33 no urgency, 32 no estate value and 22 no
 * source, so the card that listed them greyed out was describing the most
 * common and most fixable state in the pipeline while offering nothing to do
 * about it.
 *
 * This is deliberately *not* a second `computeNextAction()`. That one owns the
 * pipeline step — send the intake, quote the fee, draft the engagement. This
 * says what the firm does not know. The caller drops any gap the pipeline step
 * already covers, so the two never say the same thing twice.
 */
export type LeadScoreGap = {
  key: LeadScoreComponentKey
  /** Imperative, because it is rendered on a button. */
  label: string
  /** What answering it is worth — the component's whole ceiling. */
  points: number
  /** The record field that closes it, where one does. */
  field?: LeadEditableField
  /** For a gap no field can close: an intent for `handleNextAction`. */
  intent?: string
}

const GAP_REMEDIES: Partial<Record<LeadScoreComponentKey, Omit<LeadScoreGap, 'key' | 'points'>>> = {
  fee: { label: 'Quote the fee', field: 'fee' },
  estate: { label: 'Record the estate value', field: 'estimatedEstateValue' },
  // Not a field: the record is silent because nobody has spoken to them.
  recency: { label: 'Log a call or email', intent: 'email' },
  urgency: { label: 'Set the urgency', field: 'urgency' },
  source: { label: 'Record where they came from', field: 'source' },
  // `readiness` is deliberately absent. It is computed from the record as a
  // whole, so there is no single field to send anyone to, and the detail page
  // always supplies it anyway.
}

/**
 * Unanswered questions, richest first — the order the card truncates by, so a
 * lead missing everything is asked for the 15-point answers, not whichever
 * three happen to be declared first.
 */
export function leadScoreGaps(score: LeadScore): LeadScoreGap[] {
  return score.components
    .filter(component => !component.available)
    .map(component => {
      const remedy = GAP_REMEDIES[component.key]
      return remedy ? { key: component.key, points: component.max, ...remedy } : null
    })
    .filter((gap): gap is LeadScoreGap => gap !== null)
    .sort((left, right) => right.points - left.points)
}
