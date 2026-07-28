import { calendarDayDifference, FIRM_TIMEZONE } from '@/lib/utils'
import { computeNextAction } from '@/lib/leads/nextAction'
import { computeMatterNextAction, type EngagementSnapshot } from '@/lib/matterNextAction'
import type { IntakeReadinessFlag } from '@/lib/intakeReadiness'
import type { PipelineMatter } from '@/types/database'

/**
 * A compact briefing for a phone call: what this record is waiting on, so the
 * operator knows it before answering and can see it while talking.
 *
 * Everything here is derived from state the app already surfaces elsewhere
 * (lead/matter next action, intake and engagement state, unread portal
 * messages, unreviewed uploads, review flags). Nothing is computed twice and
 * nothing new is persisted.
 */

/** A wrap-up action the operator can opt into. Each maps to an endpoint that already exists. */
export interface CallFollowUp {
  id: string
  label: string
  /** POST the drafted summary to the lead's notes (creates the timeline entry). */
  kind: 'lead_note' | 'matter_note'
}

export interface CallBriefing {
  recordType: 'lead' | 'matter'
  recordId: string
  name: string
  matterNumber: string | null
  headline: string
  /** At most two short status lines for the incoming screen. */
  lines: string[]
  /** Everything outstanding, for the live-assist sentence. */
  openItems: string[]
  /** Prefilled assistant prompts offered as chips during the call. */
  assistPrompts: string[]
  followUps: CallFollowUp[]
}

export interface LeadBriefingInput {
  leadId: string
  name: string
  leadStatus: string
  intakeSentAt: string | null
  intakeCompletedAt: string | null
  nextAppointmentAt: string | null
  feeQuoted: number | null
  hasActiveAgreement: boolean
  agreementSigned: boolean
  lastTouchAt: string | null
  now?: string
  timeZone?: string
}

export interface MatterBriefingInput {
  matter: PipelineMatter
  /** `matters.matter_number` — the pipeline view carries the name, not the number. */
  matterNumber?: string | null
  engagement?: EngagementSnapshot
  reviewFlags?: IntakeReadinessFlag[]
  unreadMessages?: number
  unreviewedUploads?: number
  now?: string
  timeZone?: string
}

function daysAgoLabel(
  iso: string | null | undefined,
  now: string | undefined,
  timeZone: string,
): string | null {
  if (!iso) return null
  const days = calendarDayDifference(now ?? new Date(), iso, timeZone)
  if (days === null || days < 0) return null
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days}d ago`
}

function formatFee(amount: number | null | undefined): string | null {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return null
  return `$${amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

/** Cap the incoming screen at two lines so it stays readable while the phone rings. */
function briefingLines(candidates: (string | null)[]): string[] {
  return candidates.filter((line): line is string => Boolean(line)).slice(0, 2)
}

export function buildLeadBriefing(input: LeadBriefingInput): CallBriefing {
  const timeZone = input.timeZone ?? FIRM_TIMEZONE
  const nextAction = computeNextAction({
    leadStatus: input.leadStatus,
    intakeSentAt: input.intakeSentAt,
    intakeCompletedAt: input.intakeCompletedAt,
    nextAppointmentAt: input.nextAppointmentAt,
    feeQuoted: input.feeQuoted,
    hasActiveAgreement: input.hasActiveAgreement,
    lastTouchAt: input.lastTouchAt,
    timeZone,
  })

  const fee = formatFee(input.feeQuoted)
  const intakeLine = input.intakeCompletedAt
    ? 'intake complete'
    : input.intakeSentAt
      ? `intake sent ${daysAgoLabel(input.intakeSentAt, input.now, timeZone) ?? 'recently'}`
      : 'intake not sent'
  const engagementLine = input.agreementSigned
    ? 'engagement signed'
    : input.hasActiveAgreement
      ? 'engagement out for signature'
      : 'engagement not sent'
  const lastTouch = daysAgoLabel(input.lastTouchAt, input.now, timeZone)

  const openItems = [
    nextAction.key !== 'nothing' ? nextAction.title : null,
    !input.intakeCompletedAt ? (input.intakeSentAt ? 'Intake still incomplete' : 'Intake not sent') : null,
    !fee ? 'No fee quoted' : null,
    !input.hasActiveAgreement && input.intakeCompletedAt ? 'No engagement agreement out' : null,
  ].filter((item): item is string => Boolean(item))

  return {
    recordType: 'lead',
    recordId: input.leadId,
    name: input.name,
    matterNumber: null,
    headline: nextAction.key !== 'nothing' ? nextAction.title : 'Nothing outstanding',
    lines: briefingLines([
      `${engagementLine} · ${intakeLine}`,
      [fee ? `fee ${fee}` : 'no fee quoted', lastTouch ? `last touch ${lastTouch}` : null]
        .filter(Boolean)
        .join(' · '),
    ]),
    openItems,
    assistPrompts: [
      fee ? 'Read me the fee quote' : 'Draft a fee quote for this lead',
      input.nextAppointmentAt ? 'Summarize this lead before the meeting' : 'Book the next meeting',
    ],
    followUps: [
      {
        id: 'lead_note',
        label: 'Add this summary to the lead timeline',
        kind: 'lead_note',
      },
    ],
  }
}

export function buildMatterBriefing(input: MatterBriefingInput): CallBriefing {
  const timeZone = input.timeZone ?? FIRM_TIMEZONE
  const { matter } = input
  const reviewFlags = input.reviewFlags ?? []
  const unread = input.unreadMessages ?? 0
  const uploads = input.unreviewedUploads ?? 0
  const nextAction = computeMatterNextAction(matter, input.engagement, reviewFlags)

  const appointment = matter.next_appointment
    ? daysAgoLabel(matter.next_appointment, input.now, timeZone)
    : null

  const openItems = [
    nextAction.title,
    unread > 0 ? `${unread} unread portal message${unread === 1 ? '' : 's'}` : null,
    uploads > 0 ? `${uploads} upload${uploads === 1 ? '' : 's'} not yet reviewed` : null,
    reviewFlags.length > 0 ? `${reviewFlags.length} intake review flag${reviewFlags.length === 1 ? '' : 's'}` : null,
  ].filter((item): item is string => Boolean(item))

  return {
    recordType: 'matter',
    recordId: matter.matter_id,
    name: matter.client_name ?? matter.matter_name ?? 'Client',
    matterNumber: input.matterNumber ?? null,
    headline: nextAction.title,
    lines: briefingLines([
      [matter.stage ? `stage ${matter.stage}` : null, nextAction.detail ? null : matter.intake_status]
        .filter(Boolean)
        .join(' · ') || null,
      [
        unread > 0 ? `${unread} unread message${unread === 1 ? '' : 's'}` : null,
        uploads > 0 ? `${uploads} upload${uploads === 1 ? '' : 's'} to review` : null,
        appointment ? `appointment ${appointment}` : null,
      ]
        .filter(Boolean)
        .join(' · ') || null,
    ]),
    openItems,
    assistPrompts: [
      'Read me the fee quote',
      matter.signing_date ? 'Summarize the design sheet for drafting' : 'Book the signing',
    ],
    followUps: [
      {
        id: 'matter_note',
        label: 'Save this summary as a client communication note',
        kind: 'matter_note',
      },
    ],
  }
}

/** One wrapped sentence for the live-assist block. */
export function openItemsSentence(briefing: CallBriefing): string | null {
  if (briefing.openItems.length === 0) return null
  const items = briefing.openItems.map(item => item.replace(/\.$/, ''))
  if (items.length === 1) return `${items[0]}.`
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}.`
}
