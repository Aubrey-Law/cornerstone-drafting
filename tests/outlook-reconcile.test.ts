import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/microsoftCalendar', () => ({
  getAccessToken: vi.fn(),
  getMicrosoftConnectionForUser: vi.fn(),
}))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: vi.fn() }))

import { planOutlookReconciliation } from '@/lib/appointments/outlookReconcile'
import type { OutlookEventTimes } from '@/lib/appointments/graphEvents'
import type { ReconcilableAppointment } from '@/lib/appointments/outlookReconcile'

function appointment(overrides: Partial<ReconcilableAppointment> = {}): ReconcilableAppointment {
  return {
    id: 'appt-1',
    start_time: '2026-08-10T14:00:00.000Z',
    end_time: '2026-08-10T15:00:00.000Z',
    status: 'scheduled',
    microsoft_event_id: 'ev-1',
    ...overrides,
  }
}

function graphEvents(...events: OutlookEventTimes[]): Map<string, OutlookEventTimes> {
  return new Map(events.map(event => [event.id, event]))
}

function event(overrides: Partial<OutlookEventTimes> = {}): OutlookEventTimes {
  return {
    id: 'ev-1',
    startIso: '2026-08-10T14:00:00.000Z',
    endIso: '2026-08-10T15:00:00.000Z',
    isCancelled: false,
    ...overrides,
  }
}

describe('planOutlookReconciliation', () => {
  it('does nothing when Outlook agrees with the appointment', () => {
    expect(planOutlookReconciliation([appointment()], graphEvents(event()))).toEqual([])
  })

  it('moves the appointment when Outlook holds a different time', () => {
    const actions = planOutlookReconciliation(
      [appointment()],
      graphEvents(event({ startIso: '2026-08-10T16:30:00.000Z', endIso: '2026-08-10T17:30:00.000Z' })),
    )
    expect(actions).toEqual([
      {
        appointmentId: 'appt-1',
        eventId: 'ev-1',
        kind: 'move',
        startIso: '2026-08-10T16:30:00.000Z',
        endIso: '2026-08-10T17:30:00.000Z',
      },
    ])
  })

  it('ignores sub-minute drift between Graph and Postgres', () => {
    const actions = planOutlookReconciliation(
      [appointment()],
      graphEvents(event({ startIso: '2026-08-10T14:00:30.000Z', endIso: '2026-08-10T15:00:20.000Z' })),
    )
    expect(actions).toEqual([])
  })

  it('cancels the appointment when Outlook cancelled the event', () => {
    const actions = planOutlookReconciliation(
      [appointment()],
      graphEvents(event({ isCancelled: true })),
    )
    expect(actions).toEqual([{ appointmentId: 'appt-1', eventId: 'ev-1', kind: 'cancel' }])
  })

  it('rechecks rather than cancelling when the event is absent from the range', () => {
    const actions = planOutlookReconciliation([appointment()], graphEvents())
    expect(actions).toEqual([{ appointmentId: 'appt-1', eventId: 'ev-1', kind: 'recheck' }])
  })

  it('leaves appointments Outlook does not own, or that are already closed, alone', () => {
    const actions = planOutlookReconciliation(
      [
        appointment({ id: 'no-event', microsoft_event_id: null }),
        appointment({ id: 'already-cancelled', status: 'cancelled', microsoft_event_id: 'ev-2' }),
        appointment({ id: 'no-show', status: 'no_show', microsoft_event_id: 'ev-3' }),
      ],
      graphEvents(),
    )
    expect(actions).toEqual([])
  })

  it('plans each appointment independently', () => {
    const actions = planOutlookReconciliation(
      [
        appointment({ id: 'moved', microsoft_event_id: 'ev-moved' }),
        appointment({ id: 'gone', microsoft_event_id: 'ev-gone' }),
        appointment({ id: 'agreed', microsoft_event_id: 'ev-agreed' }),
      ],
      graphEvents(
        event({ id: 'ev-moved', startIso: '2026-08-11T14:00:00.000Z', endIso: '2026-08-11T15:00:00.000Z' }),
        event({ id: 'ev-agreed' }),
      ),
    )
    expect(actions.map(a => [a.appointmentId, a.kind])).toEqual([
      ['moved', 'move'],
      ['gone', 'recheck'],
    ])
  })
})
