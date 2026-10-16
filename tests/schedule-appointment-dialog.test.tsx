// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'token-1' }))

import { ScheduleAppointmentDialog } from '@/components/scheduling/ScheduleAppointmentDialog'
import { anyTimeStartIso, formatSlotSummary } from '@/app/admin/calendar/QuickBookPopover'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('formatSlotSummary', () => {
  it('shows the weekday, date and time in the firm zone', () => {
    expect(formatSlotSummary('2026-10-12T18:00:00.000Z', 'America/New_York')).toBe('Mon, Oct 12 · 2:00 PM EDT')
  })
})

describe('anyTimeStartIso', () => {
  it('reads a typed date and time in the firm zone', () => {
    expect(anyTimeStartIso('2026-10-12', '19:30', 'America/New_York')).toBe('2026-10-12T23:30:00.000Z')
    expect(anyTimeStartIso('2026-12-14', '08:00', 'America/New_York')).toBe('2026-12-14T13:00:00.000Z')
    expect(anyTimeStartIso('2026-10-12', '', 'America/New_York')).toBeNull()
  })
})

describe('ScheduleAppointmentDialog', () => {
  it('books from a month calendar, prefilled and linked to the lead', async () => {
    // Two days out at 15:00 UTC, so the slot is in the future and on a picker day.
    const start = new Date(Date.now() + 2 * 86_400_000)
    start.setUTCHours(15, 0, 0, 0)
    const slot = start.toISOString()
    const posted: Record<string, unknown>[] = []
    const slotRequests: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posted.push(JSON.parse(String(init.body)))
        return { ok: true, json: async () => ({ ok: true }) }
      }
      if (url.startsWith('/api/admin/scheduling/settings')) {
        return { ok: true, json: async () => ({
          settings: { timezone: 'America/New_York' },
          types: [{ id: 'type-1', label: 'Design Meeting', durationMinutes: 60, locationType: 'phone', locationTypes: ['phone'], active: true, bookingQuestions: [] }],
        }) }
      }
      if (url.startsWith('/api/admin/scheduling/slots')) {
        slotRequests.push(url)
        return { ok: true, json: async () => ({ connected: true, horizonDays: 180, slots: [{ startIso: slot, endIso: slot, afterHours: true, meetingOrdinal: 1 }] }) }
      }
      return { ok: false, json: async () => ({}) }
    }))
    const onBooked = vi.fn()
    render(
      <ScheduleAppointmentDialog
        target={{ kind: 'lead', id: 'lead-1' }}
        attendee={{ firstName: 'Mary', lastName: 'Jones', email: 'mary@example.com', phone: '555-0100' }}
        open
        onOpenChange={vi.fn()}
        onBooked={onBooked}
      />,
    )

    expect(screen.queryByPlaceholderText('Search contacts, leads, or matters…')).toBeNull()
    expect((await screen.findByLabelText('First name') as HTMLInputElement).value).toBe('Mary')
    expect((screen.getByLabelText('Last name') as HTMLInputElement).value).toBe('Jones')

    // The client-style month grid: the next month button and a highlighted day.
    expect(await screen.findByRole('button', { name: 'Next month' })).toBeTruthy()
    const time = await screen.findByRole('button', { name: /after hours/ })
    expect(slotRequests[0]).toContain('typeId=type-1')
    fireEvent.click(time)
    expect(await screen.findByText(formatSlotSummary(slot, 'America/New_York'))).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Book & email confirmation' }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({ typeId: 'type-1', startIso: slot, attendeeEmail: 'mary@example.com', linkedLeadId: 'lead-1' })
    await waitFor(() => expect(onBooked).toHaveBeenCalled())
  })

  it('splits a matter client name at once, then uses the stored first and last names', async () => {
    let resolveStored: ((value: unknown) => void) | null = null
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.startsWith('/api/admin/scheduling/settings')) {
        return { ok: true, json: async () => ({ types: [{ id: 'type-1', label: 'Signing', durationMinutes: 60, locationType: 'phone', locationTypes: ['phone'], active: true }] }) }
      }
      if (url.startsWith('/api/admin/calendar/people?matterId=matter-1')) {
        return { ok: true, json: () => new Promise(resolve => { resolveStored = resolve }) }
      }
      return { ok: true, json: async () => ({ connected: true, slots: [] }) }
    }))
    render(
      <ScheduleAppointmentDialog
        target={{ kind: 'matter', id: 'matter-1' }}
        attendee={{ firstName: 'Mary Jane van Buren', email: 'mary@example.com', secondFirstName: 'Sam Jones' }}
        open
        onOpenChange={vi.fn()}
      />,
    )
    expect((await screen.findByLabelText('First name') as HTMLInputElement).value).toBe('Mary Jane van')
    expect((screen.getByLabelText('Last name') as HTMLInputElement).value).toBe('Buren')
    expect((screen.getByLabelText('Spouse/partner last name') as HTMLInputElement).value).toBe('Jones')
    await waitFor(() => expect(resolveStored).not.toBeNull())
    resolveStored!({ attendee: { firstName: 'Mary Jane', lastName: 'van Buren', email: 'mary@example.com', phone: '', secondFirstName: 'Sam', secondLastName: 'Jones', secondEmail: '' } })
    await waitFor(() => expect((screen.getByLabelText('Last name') as HTMLInputElement).value).toBe('van Buren'))
    expect((screen.getByLabelText('First name') as HTMLInputElement).value).toBe('Mary Jane')
  })

  it('books a typed time outside the openings after staff confirm the warning', async () => {
    const posted: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body))
        posted.push(body)
        if (!body.overrideWarnings) {
          return { ok: false, status: 409, json: async () => ({
            error: 'That time is outside business hours for this appointment type.',
            requiresConfirmation: true,
            warnings: [{ kind: 'outside_hours', message: 'That time is outside business hours for this appointment type.' }],
          }) }
        }
        return { ok: true, status: 200, json: async () => ({ ok: true }) }
      }
      if (url.startsWith('/api/admin/scheduling/settings')) {
        return { ok: true, json: async () => ({
          settings: { timezone: 'America/New_York' },
          types: [{ id: 'type-1', label: 'Design Meeting', durationMinutes: 60, locationType: 'phone', locationTypes: ['phone'], active: true, bookingQuestions: [] }],
        }) }
      }
      if (url.startsWith('/api/admin/scheduling/slots')) {
        return { ok: true, json: async () => ({ connected: true, horizonDays: 180, slots: [] }) }
      }
      return { ok: false, json: async () => ({}) }
    }))
    const onBooked = vi.fn()
    render(
      <ScheduleAppointmentDialog
        target={{ kind: 'lead', id: 'lead-1' }}
        attendee={{ firstName: 'Mary', lastName: 'Jones', email: 'mary@example.com' }}
        open
        onOpenChange={vi.fn()}
        onBooked={onBooked}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Any time' }))
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-12' } })
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '19:30' } })
    const evening = '2026-10-12T23:30:00.000Z'
    expect(await screen.findByText(formatSlotSummary(evening, 'America/New_York'))).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Book & email confirmation' }))
    expect(await screen.findByText('That time is outside business hours for this appointment type.')).toBeTruthy()
    expect(onBooked).not.toHaveBeenCalled()
    expect(posted[0]).toMatchObject({ startIso: evening })
    expect(posted[0].overrideWarnings).toBeUndefined()

    fireEvent.click(screen.getByRole('button', { name: 'Book anyway' }))
    await waitFor(() => expect(posted).toHaveLength(2))
    expect(posted[1]).toMatchObject({ startIso: evening, overrideWarnings: true })
    await waitFor(() => expect(onBooked).toHaveBeenCalled())
  })
})
