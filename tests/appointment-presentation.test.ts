import { describe, expect, it } from 'vitest'
import {
  appointmentPreparationWorkKey,
  formatAppointmentTime,
  getAppointmentPreparationStatus,
} from '@/lib/work/appointmentPresentation'
import type { TodayAppointment } from '@/lib/queries/today'
import type { WorkItem } from '@/lib/work/types'

const appointment: TodayAppointment = {
  id: 'appointment:consultation-1',
  matter_id: 'matter-1',
  client_name: 'Jordan Client',
  next_appointment: '2026-10-02T13:00:00.000Z',
  end_at: '2026-10-02T14:00:00.000Z',
  next_appointment_type: 'Initial consultation',
  href: '/admin/matters/matter-1',
  is_all_day: false,
}

function workItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    workKey: appointmentPreparationWorkKey(appointment),
    sourceType: 'appointment_prep',
    sourceIds: ['consultation-1'],
    evidence: [],
    record: { type: 'matter', id: 'matter-1', name: 'Jordan Client' },
    title: 'Prepare for Initial consultation',
    actionLabel: 'Prepare',
    href: appointment.href,
    owner: 'firm',
    state: 'open',
    priorityBand: 1,
    priorityReasons: [{ code: 'appointment_soon', label: 'Appointment soon' }],
    estimateMinutes: 20,
    ...overrides,
  }
}

describe('appointment presentation', () => {
  it('formats timed and all-day appointments in the firm timezone', () => {
    expect(formatAppointmentTime(appointment)).toBe('9:00 AM–10:00 AM')
    expect(formatAppointmentTime({ ...appointment, is_all_day: true })).toBe('All day')
  })

  it('uses the canonical appointment preparation key and status', () => {
    expect(appointmentPreparationWorkKey(appointment)).toBe('appointment:appointment:consultation-1:prepare')
    expect(getAppointmentPreparationStatus(appointment, [workItem()])).toEqual({ label: 'Prep due today', tone: 'urgent' })
  })

  it('makes blocked and missing preparation explicit', () => {
    expect(getAppointmentPreparationStatus(appointment, [workItem({ state: 'blocked' })])).toEqual({ label: 'Prep blocked', tone: 'warning' })
    expect(getAppointmentPreparationStatus(appointment, [])).toEqual({ label: 'No prep task', tone: 'muted' })
  })
})
