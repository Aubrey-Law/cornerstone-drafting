// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BookingWidget, { type BookingWidgetType } from '@/components/scheduling/BookingWidget'
import SchedulePageClient from '@/app/(portal)/schedule/SchedulePageClient'
import { QuickBookPopover } from '@/app/admin/calendar/QuickBookPopover'

const type: BookingWidgetType = { key: 'discovery_call', slug: 'discovery-call', label: 'Discovery Call', description: '', durationMinutes: 30, locationType: 'teams' }
const slot = new Date(new Date().setHours(14, 0, 0, 0)).toISOString()
let submitted: Record<string, unknown>[]
beforeEach(() => {
  submitted = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      submitted.push(JSON.parse(String(init.body)))
      return { ok: true, json: async () => ({ ok: true, startTime: slot }) }
    }
    return { ok: true, json: async () => ({ slots: [slot], connected: true }) }
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
async function chooseSlot() {
  // The picker fetches, groups by day and auto-selects a day before times render;
  // under a loaded CI runner that can exceed findByRole's 1s default.
  fireEvent.click(await screen.findByRole('button', { name: new Date(slot).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) }, { timeout: 5000 }))
  // Wide and narrow layouts each render a Continue control; CSS shows one.
  fireEvent.click(screen.getAllByRole('button', { name: 'Continue' })[0])
}
function fill(label: string, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }) }

describe('booking component names', () => {
  it('collects and submits explicit primary and spouse names', async () => {
    render(<BookingWidget type={type} />)
    await chooseSlot()
    fill('First name', 'Mary Jane'); fill('Last name', 'van Buren'); fill('Email', 'mary@example.com')
    expect((screen.getByLabelText('First name') as HTMLInputElement).maxLength).toBe(80)
    expect((screen.getByLabelText('Last name') as HTMLInputElement).required).toBe(true)
    fireEvent.click(screen.getByLabelText('Include my spouse or partner'))
    fill('Spouse/partner first name', 'Jo Ann'); fill('Spouse/partner last name', 'de la Cruz')
    fill('Spouse/partner email', 'jo@example.com')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm booking' }))
    await screen.findByText("You're booked")
    expect(submitted[0]).toMatchObject({ firstName: 'Mary Jane', lastName: 'van Buren', secondAttendeeFirstName: 'Jo Ann', secondAttendeeLastName: 'de la Cruz' })
    expect(submitted[0]).not.toHaveProperty('name')
    expect(submitted[0]).not.toHaveProperty('secondAttendeeName')
  })

  it('returns to the calendar with the time cleared when the slot was taken', async () => {
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      if (init?.method === 'POST') {
        return { ok: false, json: async () => ({ ok: false, code: 'slot_taken', error: 'That time was just booked.' }) } as Response
      }
      return { ok: true, json: async () => ({ slots: [slot] }) } as Response
    })
    render(<BookingWidget type={type} />)
    await chooseSlot()
    fill('First name', 'Mary'); fill('Last name', 'Jones'); fill('Email', 'mary@example.com')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm booking' }))
    expect(await screen.findByText('That time was just booked.')).toBeTruthy()
    expect(screen.queryByLabelText('First name')).toBeNull()
    const time = await screen.findByRole('button', { name: new Date(slot).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) }, { timeout: 5000 })
    expect(time.getAttribute('aria-pressed')).toBe('false')
    for (const btn of screen.getAllByRole('button', { name: 'Continue' })) expect((btn as HTMLButtonElement).disabled).toBe(true)
  })

  it('keeps historical portal display names intact and requires last-name confirmation', async () => {
    render(<SchedulePageClient types={[type]} defaultName="Mary Jane van Buren" defaultEmail="session@example.com" defaultPhone="" />)
    await chooseSlot()
    expect((screen.getByLabelText('First name') as HTMLInputElement).value).toBe('Mary Jane van Buren')
    const last = screen.getByLabelText('Last name') as HTMLInputElement
    expect(last.value).toBe(''); expect(last.required).toBe(true)
    expect((screen.getByLabelText('Email') as HTMLInputElement).readOnly).toBe(true)
  })

  it('preserves known portal name components', async () => {
    render(<SchedulePageClient types={[type]} defaultFirstName="Mary Jane" defaultLastName="van Buren" defaultEmail="session@example.com" defaultPhone="" />)
    await chooseSlot()
    expect((screen.getByLabelText('First name') as HTMLInputElement).value).toBe('Mary Jane')
    expect((screen.getByLabelText('Last name') as HTMLInputElement).value).toBe('van Buren')
  })

  it('lets staff enter explicit primary and partner components', async () => {
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      if (init?.method === 'POST') {
        submitted.push(JSON.parse(String(init.body)))
        return { ok: true, json: async () => ({ ok: true }) } as Response
      }
      return { ok: true, json: async () => ({ connected: true, slots: [{ startIso: slot, endIso: new Date(Date.parse(slot) + 30 * 60_000).toISOString(), afterHours: false, meetingOrdinal: 1 }] }) } as Response
    })
    render(<QuickBookPopover open onOpenChange={vi.fn()} types={[{ ...type, id: 'type-1', locationTypes: ['teams'], active: true }]} prefillIso={slot} authHeaders={() => undefined} onBooked={vi.fn()} />)
    fill('First name', 'Mary Jane'); fill('Last name', 'van Buren'); fill('Email', 'mary@example.com')
    fill('Spouse/partner first name', 'Jo Ann'); fill('Spouse/partner last name', 'de la Cruz')
    await waitFor(() => expect((screen.getByRole('button', { name: 'Book & email confirmation' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Book & email confirmation' }))
    await waitFor(() => expect(submitted).toHaveLength(1))
    expect(submitted[0]).toMatchObject({ attendeeFirstName: 'Mary Jane', attendeeLastName: 'van Buren', secondAttendeeFirstName: 'Jo Ann', secondAttendeeLastName: 'de la Cruz' })
  })

  it('requires confirmation instead of splitting historical names selected by staff', async () => {
    vi.mocked(fetch).mockImplementation(async url => ({ ok: true, json: async () => String(url).includes('/people?')
      ? { people: [{ id: 'lead:1', kind: 'lead', recordId: '1', name: 'Mary Jane van Buren', email: 'mary@example.com', phone: null, secondName: 'Jo Ann de la Cruz', secondEmail: 'jo@example.com' }] }
      : { connected: true, slots: [] } }) as Response)
    render(<QuickBookPopover open onOpenChange={vi.fn()} types={[{ ...type, id: 'type-1', locationTypes: ['teams'], active: true }]} prefillIso={slot} authHeaders={() => undefined} onBooked={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('Search contacts, leads, or matters…'), { target: { value: 'Mary' } })
    // The month picker pages ahead past empty months while this loads; allow CI headroom.
    fireEvent.click(await screen.findByRole('button', { name: /Mary Jane van Buren/ }, { timeout: 5000 }))
    expect((screen.getByLabelText('First name') as HTMLInputElement).value).toBe('Mary Jane van Buren')
    expect((screen.getByLabelText('Last name') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Spouse/partner first name') as HTMLInputElement).value).toBe('Jo Ann de la Cruz')
    expect((screen.getByLabelText('Spouse/partner last name') as HTMLInputElement).value).toBe('')
    expect((screen.getByRole('button', { name: 'Book & email confirmation' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
