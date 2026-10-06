import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createCalendarHold: vi.fn(),
  listFilings: vi.fn(),
  setFilingCalendarEvent: vi.fn(),
}))

vi.mock('@/lib/appointments/googleEvents', () => ({ createCalendarHold: mocks.createCalendarHold }))
vi.mock('@/lib/payroll/server', () => ({ listFilings: mocks.listFilings, setFilingCalendarEvent: mocks.setFilingCalendarEvent }))

import { firmMorningUtc, syncPayrollCalendar } from '@/lib/payroll/calendar'

const filing = (key: string, dueDate: string, extra: Record<string, unknown> = {}) =>
  ({ key, title: key, agency: 'IRS', dueDate, notes: '', kind: 'filing', id: 'x', doneOn: null, confirmation: null, calendarEventId: null, ...extra })

describe('payroll calendar sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createCalendarHold.mockImplementation(async (input: { idempotencyKey: string }) => ({ eventId: `ev-${input.idempotencyKey}`, onlineMeetingUrl: null }))
  })

  it('converts 9:00 Eastern to UTC across daylight saving', () => {
    expect(firmMorningUtc('2026-07-31').toISOString()).toBe('2026-07-31T13:00:00.000Z')
    expect(firmMorningUtc('2027-02-01').toISOString()).toBe('2027-02-01T14:00:00.000Z')
  })

  it('adds a non-blocking hold for each open upcoming deadline, idempotently keyed', async () => {
    mocks.listFilings.mockResolvedValue([
      filing('941-Q3', '2026-11-02'),
      filing('941-Q2', '2026-07-31'), // past
      filing('DUA-Q3', '2026-11-02', { doneOn: '2026-10-20' }), // done
      filing('PFML-Q3', '2026-11-02', { calendarEventId: 'ev-old' }), // already on the calendar
      filing('fed-deposit:abc', '2026-11-16', { id: null, runId: 'abc' }),
    ])
    const result = await syncPayrollCalendar(2026, '2026-10-06')
    expect(result).toEqual({ created: 2, skipped: 3, failed: [] })
    expect(mocks.createCalendarHold).toHaveBeenCalledWith({
      title: 'Payroll · 941-Q3 due',
      startIso: '2026-11-02T14:00:00.000Z',
      endIso: '2026-11-02T14:30:00.000Z',
      showAsBusy: false,
      idempotencyKey: 'payroll:2026:941-Q3',
    })
    expect(mocks.setFilingCalendarEvent).toHaveBeenCalledWith(2026, 'fed-deposit:abc', 'ev-payroll:2026:fed-deposit:abc')
  })

  it('reports a calendar failure per deadline without stopping the rest', async () => {
    mocks.listFilings.mockResolvedValue([filing('941-Q3', '2026-11-02'), filing('940', '2027-02-01')])
    mocks.createCalendarHold.mockRejectedValueOnce(new Error('Google Calendar is not connected'))
    const result = await syncPayrollCalendar(2026, '2026-10-06')
    expect(result.created).toBe(1)
    expect(result.failed).toEqual([{ key: '941-Q3', error: 'Google Calendar is not connected' }])
  })
})
