import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computeNextAction } from '@/lib/leads/nextAction'

const baseInput = {
  leadStatus: 'lead',
  intakeSentAt: null,
  intakeCompletedAt: null,
  nextAppointmentAt: null,
  feeQuoted: null,
  hasActiveAgreement: false,
  lastTouchAt: null,
}

describe('computeNextAction', () => {
  beforeEach(() => vi.useFakeTimers().setSystemTime(new Date('2026-07-25T16:00:00Z')))
  afterEach(() => vi.useRealTimers())

  it.each(['hired', 'lost'])('suppresses next actions for a %s lead', leadStatus => {
    expect(computeNextAction({
      ...baseInput,
      leadStatus,
      intakeCompletedAt: '2026-07-24T16:00:00Z',
      feeQuoted: 2500,
    })).toEqual({ key: 'nothing', title: '', detail: '', actions: [] })
  })

  it('sends intake before a discovery call exactly fourteen days out', () => {
    expect(computeNextAction({
      ...baseInput,
      nextAppointmentAt: '2026-08-08T16:00:00Z',
    })).toEqual({
      key: 'send_intake',
      title: 'Send intake before the discovery call',
      detail: 'Discovery call is August 8, 2026 (14 days out). Intake has never been sent.',
      actions: [
        { label: 'Send intake', kind: 'primary', intent: 'send_intake' },
        { label: 'Fill it myself', kind: 'secondary', intent: 'fill_intake' },
        { label: 'Import', kind: 'secondary', intent: 'import_intake' },
        { label: 'Snooze', kind: 'secondary', intent: 'snooze' },
      ],
    })
  })

  it('sends intake to get the facts when no future appointment is scheduled', () => {
    expect(computeNextAction(baseInput)).toEqual({
      key: 'send_intake',
      title: 'Send intake to get the facts',
      detail: 'Intake has never been sent.',
      actions: [
        { label: 'Send intake', kind: 'primary', intent: 'send_intake' },
        { label: 'Fill it myself', kind: 'secondary', intent: 'fill_intake' },
        { label: 'Import', kind: 'secondary', intent: 'import_intake' },
        { label: 'Snooze', kind: 'secondary', intent: 'snooze' },
      ],
    })
  })

  it('resends an unanswered intake when the discovery call is exactly three days out', () => {
    expect(computeNextAction({
      ...baseInput,
      intakeSentAt: '2026-07-20T16:00:00Z',
      nextAppointmentAt: '2026-07-28T16:00:00Z',
    })).toEqual({
      key: 'send_intake',
      title: 'Resend intake — still unanswered',
      detail: 'Discovery call is July 28, 2026 (3 days out). Intake was sent but has not been completed.',
      actions: [
        { label: 'Resend intake', kind: 'primary', intent: 'send_intake' },
        { label: 'Fill it myself', kind: 'secondary', intent: 'fill_intake' },
        { label: 'Snooze', kind: 'secondary', intent: 'snooze' },
      ],
    })
  })

  it('does not resend an unanswered intake when the discovery call is four days out', () => {
    expect(computeNextAction({
      ...baseInput,
      intakeSentAt: '2026-07-20T16:00:00Z',
      nextAppointmentAt: '2026-07-29T16:00:00Z',
    })).toEqual({ key: 'nothing', title: '', detail: '', actions: [] })
  })

  it('prompts to quote a fee when intake is complete without a quote', () => {
    expect(computeNextAction({
      ...baseInput,
      intakeCompletedAt: '2026-07-24T16:00:00Z',
    })).toEqual({
      key: 'quote_fee',
      title: 'Quote the engagement fee',
      detail: 'The intake is complete, but no fee has been quoted.',
      actions: [
        { label: 'Quote fee', kind: 'primary', intent: 'quote_fee' },
        { label: 'Review intake', kind: 'secondary', intent: 'review_intake' },
      ],
    })
  })

  it('prompts to draft the engagement agreement when a fee is quoted', () => {
    expect(computeNextAction({
      ...baseInput,
      intakeCompletedAt: '2026-07-24T16:00:00Z',
      feeQuoted: 2500,
    })).toEqual({
      key: 'draft_engagement',
      title: 'Draft the engagement agreement',
      detail: 'The fee is set and the lead is ready for an agreement.',
      actions: [
        { label: 'Draft engagement', kind: 'primary', intent: 'draft_engagement' },
        { label: 'Review intake', kind: 'secondary', intent: 'review_intake' },
      ],
    })
  })

  it('does not follow up at exactly seven days since the last touch', () => {
    expect(computeNextAction({
      ...baseInput,
      intakeSentAt: '2026-07-20T16:00:00Z',
      lastTouchAt: '2026-07-18T16:00:00Z',
    })).toEqual({ key: 'nothing', title: '', detail: '', actions: [] })
  })

  it('follows up after more than seven days since the last touch', () => {
    expect(computeNextAction({
      ...baseInput,
      intakeSentAt: '2026-07-20T16:00:00Z',
      lastTouchAt: '2026-07-17T16:00:00Z',
    })).toEqual({
      key: 'follow_up',
      title: 'Follow up with this lead',
      detail: 'Last touch was 8 days ago.',
      actions: [
        { label: 'Call', kind: 'primary', intent: 'call' },
        { label: 'Email', kind: 'secondary', intent: 'email' },
      ],
    })
  })

  it('reviews a completed intake when no higher-priority action applies', () => {
    expect(computeNextAction({
      ...baseInput,
      intakeCompletedAt: '2026-07-24T16:00:00Z',
      feeQuoted: 2500,
      hasActiveAgreement: true,
      lastTouchAt: '2026-07-24T16:00:00Z',
    })).toEqual({
      key: 'review_intake',
      title: 'Review the completed intake',
      detail: 'Confirm the intake before the next client step.',
      actions: [{ label: 'Review intake', kind: 'primary', intent: 'review_intake' }],
    })
  })

  it('returns nothing when no decision rule applies', () => {
    expect(computeNextAction({
      ...baseInput,
      intakeSentAt: '2026-07-20T16:00:00Z',
    })).toEqual({ key: 'nothing', title: '', detail: '', actions: [] })
  })

  it('does not share static action objects between results', () => {
    const input = {
      ...baseInput,
      intakeCompletedAt: '2026-07-24T16:00:00Z',
    }

    computeNextAction(input).actions[0].label = 'Changed by caller'

    expect(computeNextAction(input).actions[0]).toEqual({
      label: 'Quote fee',
      kind: 'primary',
      intent: 'quote_fee',
    })
  })

  it('uses firm calendar days across fall DST for the fourteen-day appointment boundary', () => {
    vi.setSystemTime(new Date('2026-10-25T04:30:00Z')) // Oct 25, 00:30 EDT

    expect(computeNextAction({
      ...baseInput,
      nextAppointmentAt: '2026-11-08T05:30:00Z', // Nov 8, 00:30 EST
      timeZone: 'America/New_York',
    })).toMatchObject({
      title: 'Send intake before the discovery call',
      detail: 'Discovery call is November 8, 2026 (14 days out). Intake has never been sent.',
    })
  })

  it('uses firm calendar days across spring DST for overdue follow-up', () => {
    vi.setSystemTime(new Date('2026-03-16T04:30:00Z')) // Mar 16, 00:30 EDT

    expect(computeNextAction({
      ...baseInput,
      intakeSentAt: '2026-03-01T05:30:00Z',
      lastTouchAt: '2026-03-08T05:30:00Z', // Mar 8, 00:30 EST
      timeZone: 'America/New_York',
    })).toMatchObject({
      key: 'follow_up',
      detail: 'Last touch was 8 days ago.',
    })
  })

  it('displays the appointment on its firm-local date near UTC midnight', () => {
    vi.setSystemTime(new Date('2026-07-25T16:00:00Z'))

    expect(computeNextAction({
      ...baseInput,
      nextAppointmentAt: '2026-07-26T01:00:00Z',
      timeZone: 'America/New_York',
    })).toMatchObject({
      detail: 'Discovery call is July 25, 2026 (0 days out). Intake has never been sent.',
    })
  })
})
