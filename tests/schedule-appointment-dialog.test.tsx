// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/AuthTokenProvider', () => ({ useAccessToken: () => 'token-1' }))

import { ScheduleAppointmentDialog } from '@/components/scheduling/ScheduleAppointmentDialog'
import { formatSlotSummary } from '@/app/admin/calendar/QuickBookPopover'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('formatSlotSummary', () => {
  it('shows the weekday, date and time in the firm zone', () => {
    expect(formatSlotSummary('2026-10-12T18:00:00.000Z', 'America/New_York')).toBe('Mon, Oct 12 · 2:00 PM EDT')
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
})
