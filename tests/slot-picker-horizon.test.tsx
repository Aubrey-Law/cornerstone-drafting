// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SlotPicker from '@/components/scheduling/SlotPicker'
import { EventPrepDrawer } from '@/app/admin/calendar/EventPrepDrawer'
import type { CalendarAppointment } from '@/app/admin/calendar/types'

const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

/** Availability stub: `slotsFor(from)` decides the slots per requested range. */
function stubAvailability(horizonDays: number, slotsFor: (from: Date) => string[]) {
  const calls: Date[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const from = new Date(new URL(url, 'http://localhost').searchParams.get('from')!)
    calls.push(from)
    return { ok: true, json: async () => ({ slots: slotsFor(from), horizonDays }) }
  }))
  return calls
}

function renderPicker() {
  return render(<SlotPicker typeSlug="discovery-call" selected={null} onSelect={() => {}} />)
}

beforeEach(() => {
  // Only Date is faked, so testing-library's polling timers still run.
  vi.useFakeTimers({ toFake: ['Date'] })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('SlotPicker booking horizon', () => {
  it('skips past a month with nothing left to the first month with openings', async () => {
    vi.setSystemTime(new Date(2026, 9, 29, 12)) // Oct 29
    const novemberSlot = new Date(2026, 10, 4, 10).toISOString()
    const calls = stubAvailability(60, from => (from.getMonth() === 10 ? [novemberSlot] : []))
    renderPicker()
    expect(await screen.findByRole('button', { name: timeLabel(novemberSlot) }, { timeout: 5000 })).toBeTruthy()
    expect(screen.getByText('November 2026')).toBeTruthy()
    expect(screen.queryByText('No open times this month.')).toBeNull()
    expect(calls.map(d => d.getMonth())).toEqual([9, 10])
  })

  it('disables Next once the next month starts past the horizon', async () => {
    vi.setSystemTime(new Date(2026, 9, 10, 12)) // Oct 10, horizon ends Oct 20
    const slot = new Date(2026, 9, 15, 10).toISOString()
    stubAvailability(10, () => [slot])
    renderPicker()
    await screen.findByRole('button', { name: timeLabel(slot) }, { timeout: 5000 })
    expect((screen.getByRole('button', { name: 'Next month' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('keeps Next while the next month is inside the horizon', async () => {
    vi.setSystemTime(new Date(2026, 9, 10, 12))
    const slot = new Date(2026, 9, 15, 10).toISOString()
    stubAvailability(60, () => [slot])
    renderPicker()
    await screen.findByRole('button', { name: timeLabel(slot) }, { timeout: 5000 })
    expect((screen.getByRole('button', { name: 'Next month' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('explains the booking window instead of offering a dead-end Next month', async () => {
    vi.setSystemTime(new Date(2026, 9, 25, 12)) // horizon ends Oct 28
    const calls = stubAvailability(3, () => [])
    renderPicker()
    expect(await screen.findByText(/We take online bookings up to 3 days ahead/, {}, { timeout: 5000 })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Next month →' })).toBeNull()
    expect(calls).toHaveLength(1)
  })
})

describe('EventPrepDrawer client responses', () => {
  const appointment: CalendarAppointment = {
    id: 'appt-1',
    startTime: '2026-10-07T14:30:00.000Z',
    endTime: '2026-10-07T14:45:00.000Z',
    status: 'scheduled',
    locationType: 'phone',
    secondAttendeeName: null,
    secondAttendeeEmail: null,
    attendeeName: 'Mary Jones',
    attendeeEmail: 'mary@example.com',
    attendeePhone: null,
    notes: 'Please call after 3pm.',
    bookingAnswers: [
      { questionId: 'reason', label: 'What prompted you to reach out?', answer: 'New baby\nand a house' },
    ],
    typeLabel: 'Discovery Call',
    source: 'public',
    calendarSynced: true,
    onlineMeetingUrl: null,
    linkedMatterId: null,
    linkedMatterNumber: null,
    linkedMatterStage: null,
    linkedMatterPlanType: null,
    linkedLeadId: null,
  }

  function renderDrawer(a: CalendarAppointment) {
    // The context fetch never resolves: the responses must not wait on it.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    render(
      <EventPrepDrawer
        appointment={a}
        open
        onOpenChange={() => {}}
        authHeaders={() => undefined}
        onReschedule={() => {}}
        onBookNext={() => {}}
      />,
    )
  }

  it('shows the client’s answers and notes while the meeting context loads', () => {
    renderDrawer(appointment)
    expect(screen.getByRole('heading', { name: 'From the client' })).toBeTruthy()
    expect(screen.getByText('What prompted you to reach out?')).toBeTruthy()
    expect(screen.getByText(/New baby/).textContent).toBe('New baby\nand a house')
    expect(screen.getByText('Please call after 3pm.')).toBeTruthy()
    expect(screen.getByText('Loading meeting context…')).toBeTruthy()
  })

  it('labels staff-booked notes as booking notes', () => {
    renderDrawer({ ...appointment, source: 'admin', bookingAnswers: [] })
    expect(screen.getByRole('heading', { name: 'Booking notes' })).toBeTruthy()
  })

  it('omits the section when there is nothing from the booking', () => {
    renderDrawer({ ...appointment, notes: null, bookingAnswers: [] })
    expect(screen.queryByRole('heading', { name: 'From the client' })).toBeNull()
  })
})

describe('EventPrepDrawer video service', () => {
  const future = new Date(Date.now() + 3 * 86_400_000)
  const base: CalendarAppointment = {
    id: 'appt-2', startTime: future.toISOString(), endTime: new Date(future.getTime() + 3_600_000).toISOString(),
    status: 'scheduled', locationType: 'teams', secondAttendeeName: null, secondAttendeeEmail: null,
    attendeeName: 'Mary Jones', attendeeEmail: 'mary@example.com', attendeePhone: null, notes: null,
    typeLabel: 'Design Meeting', source: 'public', calendarSynced: true, onlineMeetingUrl: null,
    linkedMatterId: null, linkedMatterNumber: null, linkedMatterStage: null, linkedMatterPlanType: null, linkedLeadId: null,
  }

  function renderWith(a: CalendarAppointment, patchResponse: Record<string, unknown> = {}) {
    const patches: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        patches.push(JSON.parse(String(init.body)))
        return { ok: true, json: async () => ({ ok: true, calendarUpdated: true, ...patchResponse }) }
      }
      return new Promise(() => {})
    }))
    const changed = vi.fn()
    render(<EventPrepDrawer appointment={a} open onOpenChange={() => {}} authHeaders={() => undefined}
      onReschedule={() => {}} onBookNext={() => {}} onAppointmentChanged={changed} />)
    return { patches, changed }
  }

  it('offers both services when no meeting link exists yet', () => {
    renderWith(base)
    expect(screen.getByRole('button', { name: 'Add Google Meet' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add Teams meeting' })).toBeTruthy()
  })

  it('switches a Teams appointment to Google Meet', async () => {
    const { patches, changed } = renderWith(
      { ...base, onlineMeetingUrl: 'https://teams.microsoft.com/l/x', onlineMeetingProvider: 'microsoft_teams' },
      { onlineMeetingUrl: 'https://meet.google.com/abc' },
    )
    expect(screen.queryByRole('button', { name: 'Switch to Teams' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Google Meet' }))
    await waitFor(() => expect(changed).toHaveBeenCalled())
    expect(patches[0]).toEqual({ appointmentId: 'appt-2', action: 'use_google_meet' })
    expect(changed.mock.calls[0][0]).toMatchObject({ onlineMeetingUrl: 'https://meet.google.com/abc', onlineMeetingProvider: 'google_meet' })
  })

  it('offers Teams instead when the appointment already has a Meet', () => {
    renderWith({ ...base, onlineMeetingUrl: 'https://meet.google.com/abc', onlineMeetingProvider: 'google_meet' })
    expect(screen.getByRole('button', { name: 'Switch to Teams' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Google Meet/ })).toBeNull()
  })

  it('offers reschedule and remove for a Lawmatics meeting, and no video switch', async () => {
    const onReschedule = vi.fn()
    const onRemove = vi.fn(async () => true)
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    render(<EventPrepDrawer
      appointment={{ ...base, source: 'lawmatics', endTime: new Date(future.getTime() + 45 * 60_000).toISOString() }}
      open onOpenChange={() => {}} authHeaders={() => undefined}
      onReschedule={onReschedule} onRemove={onRemove} onBookNext={() => {}}
    />)
    expect(screen.getByText('Managed in Lawmatics')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Google Meet|Teams/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Reschedule' }))
    expect(onReschedule).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Remove…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove meeting' }))
    await waitFor(() => expect(onRemove).toHaveBeenCalledOnce())
  })

  it('offers no switch for a past appointment', () => {
    renderWith({ ...base, startTime: '2020-01-01T10:00:00.000Z', endTime: '2020-01-01T11:00:00.000Z' })
    expect(screen.queryByRole('button', { name: /Google Meet|Teams/ })).toBeNull()
  })
})
