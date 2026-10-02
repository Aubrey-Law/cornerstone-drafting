// @vitest-environment jsdom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { TodayAppointment } from '@/lib/queries/today'
import type { WorkItem } from '@/lib/work/types'

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.ComponentProps<'a'>) => <a href={href} {...props}>{children}</a>,
}))

import { TodayAppointments } from '@/app/admin/components/CommandCenter'

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

describe('Command Center appointment strip', () => {
  it('shows appointment context, preparation state, and a calendar path', () => {
    render(<TodayAppointments appointments={[appointment]} items={[preparation]} />)

    expect(screen.getByText("Today's appointments")).toBeTruthy()
    expect(screen.getByText('9:00 AM–10:00 AM')).toBeTruthy()
    expect(screen.getByText('Jordan Client')).toBeTruthy()
    expect(screen.getByText('Initial consultation')).toBeTruthy()
    expect(screen.getByText('Prep due today')).toBeTruthy()
    expect(screen.getByRole('link', { name: /open calendar/i }).getAttribute('href')).toBe('/admin/calendar')
  })

  it('stays out of the way when there are no appointments', () => {
    const { container } = render(<TodayAppointments appointments={[]} items={[]} />)
    expect(container.innerHTML).toBe('')
  })
})
