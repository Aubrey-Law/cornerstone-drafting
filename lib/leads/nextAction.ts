import { calendarDayDifference, FIRM_TIMEZONE } from '@/lib/utils'

export type NextAction = {
  key: 'send_intake' | 'review_intake' | 'quote_fee' | 'draft_engagement' | 'follow_up' | 'nothing' | 'review_engagement' | 'prepare_meeting' | 'schedule_meeting'
  title: string
  detail: string
  actions: { label: string; kind: 'primary' | 'secondary'; intent: string }[]
}

type NextActionInput = {
  leadStatus: string
  intakeSentAt: string | null
  intakeCompletedAt: string | null
  nextAppointmentAt: string | null
  feeQuoted: number | null
  hasActiveAgreement: boolean
  lastTouchAt: string | null
  engagementStatus?: string | null
  engagementSentAt?: string | null
  engagementSignedAt?: string | null
  discoveryCallAt?: string | null
  planningSessionAt?: string | null
  timeZone?: string
}

type Action = NextAction['actions'][number]

const NOTHING = Object.freeze({
  key: 'nothing' as const,
  title: '',
  detail: '',
  actions: Object.freeze([] as Action[]),
})

const QUOTE_FEE = Object.freeze({
  key: 'quote_fee' as const,
  title: 'Quote the engagement fee',
  detail: 'The intake is complete, but no fee has been quoted.',
  actions: Object.freeze([
    { label: 'Quote fee', kind: 'primary' as const, intent: 'quote_fee' },
    { label: 'Review intake', kind: 'secondary' as const, intent: 'review_intake' },
  ]),
})

const DRAFT_ENGAGEMENT = Object.freeze({
  key: 'draft_engagement' as const,
  title: 'Draft the engagement agreement',
  detail: 'The fee is set and the lead is ready for an agreement.',
  actions: Object.freeze([
    { label: 'Draft engagement', kind: 'primary' as const, intent: 'draft_engagement' },
    { label: 'Review intake', kind: 'secondary' as const, intent: 'review_intake' },
  ]),
})

const REVIEW_INTAKE = Object.freeze({
  key: 'review_intake' as const,
  title: 'Review the completed intake',
  detail: 'Confirm the intake before the next client step.',
  actions: Object.freeze([
    { label: 'Review intake', kind: 'primary' as const, intent: 'review_intake' },
  ]),
})

function copyAction(action: Readonly<Omit<NextAction, 'actions'>> & { actions: readonly Action[] }): NextAction {
  return { ...action, actions: action.actions.map(item => ({ ...item })) }
}

function formatDate(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(iso))
}

/**
 * The banner only ever holds a timestamp, never which meeting it is. It said
 * "discovery call" because that was the only anchor the detail page could see;
 * now that the page falls back to the matter's milestones, the same slot can
 * hold a planning session, and naming it a discovery call would be wrong on
 * the leads whose call is already behind them.
 */
function initialIntakeAction(
  appointmentAt: string | null,
  appointmentDays: number | null,
  soon: boolean,
  timeZone: string,
): NextAction {
  return {
    key: 'send_intake',
    title: soon ? 'Send intake before the meeting' : 'Send intake to get the facts',
    detail: soon
      ? `Meeting is ${formatDate(appointmentAt!, timeZone)} (${appointmentDays} days out). Intake has never been sent.`
      : 'Intake has never been sent.',
    actions: [
      { label: 'Send intake', kind: 'primary', intent: 'send_intake' },
      { label: 'Fill it myself', kind: 'secondary', intent: 'fill_intake' },
      { label: 'Import', kind: 'secondary', intent: 'import_intake' },
      { label: 'Snooze', kind: 'secondary', intent: 'snooze' },
    ],
  }
}

function unansweredIntakeAction(appointmentAt: string, appointmentDays: number, timeZone: string): NextAction {
  return {
    key: 'send_intake',
    title: 'Resend intake — still unanswered',
    detail: `Meeting is ${formatDate(appointmentAt, timeZone)} (${appointmentDays} days out). Intake was sent but has not been completed.`,
    actions: [
      { label: 'Resend intake', kind: 'primary', intent: 'send_intake' },
      { label: 'Fill it myself', kind: 'secondary', intent: 'fill_intake' },
      { label: 'Snooze', kind: 'secondary', intent: 'snooze' },
    ],
  }
}

function followUpAction(days: number): NextAction {
  return {
    key: 'follow_up',
    title: 'Follow up with this lead',
    detail: `Last touch was ${days} days ago.`,
    actions: [
      { label: 'Call', kind: 'primary', intent: 'call' },
      { label: 'Email', kind: 'secondary', intent: 'email' },
    ],
  }
}

export function computeNextAction(input: NextActionInput): NextAction {
  if (['hired', 'lost', 'declined'].includes(input.leadStatus)) return copyAction(NOTHING)

  const timeZone = input.timeZone ?? FIRM_TIMEZONE
  const appointmentDays = input.nextAppointmentAt
    ? calendarDayDifference(input.nextAppointmentAt, Date.now(), timeZone)
    : null

  const engagementStatus = input.engagementStatus?.toLowerCase()
  const signed = Boolean(input.engagementSignedAt) || engagementStatus === 'signed' || engagementStatus === 'completed'
  if (signed || input.engagementSentAt || ['sent', 'sending', 'viewed', 'partially_signed'].includes(engagementStatus ?? '')) {
    return {
      key: 'review_engagement',
      title: signed ? 'Review the signed engagement' : 'Check the engagement agreement',
      detail: signed ? 'The agreement is signed. Confirm the engagement before converting this lead.' : 'An agreement is already in progress. Review its status before contacting the client.',
      actions: [{ label: 'Review engagement', kind: 'primary', intent: 'review_engagement' }],
    }
  }

  if (!input.intakeCompletedAt && !input.intakeSentAt) {
    const soon = appointmentDays !== null && appointmentDays >= 0 && appointmentDays <= 14
    return initialIntakeAction(input.nextAppointmentAt, appointmentDays, soon, timeZone)
  }

  if (!input.intakeCompletedAt && input.intakeSentAt
    && appointmentDays !== null && appointmentDays >= 0 && appointmentDays <= 3) {
    return unansweredIntakeAction(input.nextAppointmentAt!, appointmentDays, timeZone)
  }

  const planningDays = input.planningSessionAt
    ? calendarDayDifference(input.planningSessionAt, Date.now(), timeZone)
    : null
  if (input.intakeCompletedAt && planningDays !== null && planningDays >= 0) {
    return {
      key: 'prepare_meeting',
      title: 'Prepare for the planning session',
      detail: 'Review the completed intake before the scheduled planning session.',
      actions: [{ label: 'Review intake', kind: 'primary', intent: 'review_intake' }],
    }
  }
  const discoveryDays = input.discoveryCallAt
    ? calendarDayDifference(input.discoveryCallAt, Date.now(), timeZone)
    : null
  if (input.intakeCompletedAt && discoveryDays !== null && discoveryDays < 0
    && !input.planningSessionAt && (appointmentDays === null || appointmentDays < 0)
    && input.feeQuoted === null && !input.hasActiveAgreement) {
    return {
      key: 'schedule_meeting',
      title: 'Schedule the planning session',
      detail: 'Discovery and intake are complete. Set the planning session date.',
      actions: [{ label: 'Schedule planning session', kind: 'primary', intent: 'schedule_meeting' }],
    }
  }

  if (input.intakeCompletedAt && input.feeQuoted === null) return copyAction(QUOTE_FEE)
  if (input.feeQuoted !== null && !input.hasActiveAgreement) return copyAction(DRAFT_ENGAGEMENT)
  const lastTouchDays = input.lastTouchAt
    ? calendarDayDifference(Date.now(), input.lastTouchAt, timeZone)
    : null
  if (lastTouchDays !== null && lastTouchDays > 7) return followUpAction(lastTouchDays)
  if (input.intakeCompletedAt) return copyAction(REVIEW_INTAKE)

  return copyAction(NOTHING)
}
