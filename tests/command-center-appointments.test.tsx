// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { TodayAppointment } from '@/lib/queries/today'
import type { WorkItem } from '@/lib/work/types'

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.ComponentProps<'a'>) => <a href={href} {...props}>{children}</a>,
}))

import { DayAgenda } from '@/app/admin/components/CommandCenter'

afterEach(cleanup)

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

const preparation: WorkItem = {
  workKey: 'appointment:appointment:consultation-1:prepare',
  sourceType: 'appointment_prep',
  sourceIds: ['consultation-1'],
  evidence: [],
  record: { type: 'matter', id: 'matter-1', name: 'Jordan Client' },
  title: 'Prepare for initial consultation',
  actionLabel: 'Prepare',
  href: appointment.href,
  owner: 'firm',
  state: 'open',
  priorityBand: 1,
  priorityReasons: [{ code: 'appointment_soon', label: 'Appointment soon' }],
  estimateMinutes: 20,
}

describe('Command Center day agenda', () => {
  it('shows appointment context, preparation state, planned work, and a calendar path', () => {
    render(<DayAgenda
      appointments={[appointment]}
      blocks={[{ workKey: 'task:follow-up', startAt: '2026-10-02T14:10:00.000Z', endAt: '2026-10-02T14:25:00.000Z', minutes: 15 }]}
      items={[preparation, {
        workKey: 'task:follow-up', sourceType: 'task', sourceIds: ['follow-up'], evidence: [],
        record: { type: 'matter', id: 'matter-1', name: 'Jordan Client' }, title: 'Call Jordan Client', actionLabel: 'Open',
        href: '/admin/matters/matter-1?tab=tasks', owner: 'firm', state: 'open', priorityBand: 1, priorityReasons: [], estimateMinutes: 15,
      }]}
    />)

    expect(screen.getByText('Day agenda')).toBeTruthy()
    expect(screen.getByText('9:00 AM–10:00 AM')).toBeTruthy()
    expect(screen.getByText('Jordan Client')).toBeTruthy()
    expect(screen.getByText('Initial consultation')).toBeTruthy()
    expect(screen.getByText('Prep due today')).toBeTruthy()
    expect(screen.getByText('10:10 AM–10:25 AM')).toBeTruthy()
    expect(screen.getByText('Call Jordan Client')).toBeTruthy()
    expect(screen.getByText('15 min')).toBeTruthy()
    expect(screen.getByRole('link', { name: /open calendar/i }).getAttribute('href')).toBe('/admin/calendar')
  })

  it('explains an empty agenda instead of hiding the schedule', () => {
    render(<DayAgenda appointments={[]} blocks={[]} items={[]} />)
    expect(screen.getByText(/No appointments or focus blocks/)).toBeTruthy()
  })

  it('labels external calendar time as a commitment instead of missing preparation', () => {
    render(<DayAgenda
      appointments={[{
        ...appointment,
        id: 'calendar-busy:2026-10-02T13:00:00.000Z:2026-10-02T14:00:00.000Z',
        matter_id: null,
        client_name: null,
        next_appointment_type: 'Calendar commitment',
        href: '/admin/calendar',
      }]}
      blocks={[]}
      items={[]}
    />)

    expect(screen.getByText('Calendar commitment')).toBeTruthy()
    expect(screen.queryByText('No prep task')).toBeNull()
  })
})
