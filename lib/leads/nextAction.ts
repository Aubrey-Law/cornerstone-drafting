export type NextAction = {
  key: 'send_intake' | 'review_intake' | 'quote_fee' | 'draft_engagement' | 'follow_up' | 'nothing'
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
}

type Action = NextAction['actions'][number]

const DAY_MS = 86_400_000

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

const daysUntil = (iso: string) => Math.ceil((Date.parse(iso) - Date.now()) / DAY_MS)
const daysSince = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / DAY_MS)

function copyAction(action: Readonly<Omit<NextAction, 'actions'>> & { actions: readonly Action[] }): NextAction {
  return { ...action, actions: [...action.actions] }
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(iso))
}

function initialIntakeAction(appointmentAt: string | null, appointmentDays: number | null, soon: boolean): NextAction {
  return {
    key: 'send_intake',
    title: soon ? 'Send intake before the discovery call' : 'Send intake to get the facts',
    detail: soon
      ? `Discovery call is ${formatDate(appointmentAt!)} (${appointmentDays} days out). Intake has never been sent.`
      : 'Intake has never been sent.',
    actions: [
      { label: 'Send intake', kind: 'primary', intent: 'send_intake' },
      { label: 'Fill it myself', kind: 'secondary', intent: 'fill_intake' },
      { label: 'Import', kind: 'secondary', intent: 'import_intake' },
      { label: 'Snooze', kind: 'secondary', intent: 'snooze' },
    ],
  }
}

function unansweredIntakeAction(appointmentAt: string, appointmentDays: number): NextAction {
  return {
    key: 'send_intake',
    title: 'Resend intake — still unanswered',
    detail: `Discovery call is ${formatDate(appointmentAt)} (${appointmentDays} days out). Intake was sent but has not been completed.`,
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
  if (input.leadStatus === 'hired' || input.leadStatus === 'lost') return copyAction(NOTHING)

  const appointmentDays = input.nextAppointmentAt ? daysUntil(input.nextAppointmentAt) : null

  if (!input.intakeCompletedAt && !input.intakeSentAt) {
    const soon = appointmentDays !== null && appointmentDays >= 0 && appointmentDays <= 14
    return initialIntakeAction(input.nextAppointmentAt, appointmentDays, soon)
  }

  if (!input.intakeCompletedAt && input.intakeSentAt
    && appointmentDays !== null && appointmentDays >= 0 && appointmentDays <= 3) {
    return unansweredIntakeAction(input.nextAppointmentAt!, appointmentDays)
  }

  if (input.intakeCompletedAt && input.feeQuoted === null) return copyAction(QUOTE_FEE)
  if (input.feeQuoted !== null && !input.hasActiveAgreement) return copyAction(DRAFT_ENGAGEMENT)
  if (input.lastTouchAt && daysSince(input.lastTouchAt) > 7) return followUpAction(daysSince(input.lastTouchAt))
  if (input.intakeCompletedAt) return copyAction(REVIEW_INTAKE)

  return copyAction(NOTHING)
}
