// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ManageBookingClient from '@/app/book/manage/[token]/ManageBookingClient'

const start = new Date(new Date().setHours(10, 0, 0, 0) + 2 * 86_400_000)
const newSlot = new Date(new Date().setHours(14, 0, 0, 0)).toISOString()
const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

let status: string
let posted: Record<string, unknown>[]
let postResponse: { ok: boolean; body: Record<string, unknown> }
let availabilityCalls: number

function appointment() {
  return {
    status,
    startTime: start.toISOString(),
    endTime: new Date(start.getTime() + 30 * 60_000).toISOString(),
    attendeeName: 'Mary Jane van Buren',
    type: { key: 'discovery_call', slug: 'discovery-call', label: 'Discovery Call', durationMinutes: 30, locationType: 'phone' },
  }
}

beforeEach(() => {
  status = 'scheduled'
  posted = []
  postResponse = { ok: true, body: { ok: true } }
  availabilityCalls = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).startsWith('/api/scheduling/availability')) {
      availabilityCalls++
      return { ok: true, json: async () => ({ slots: [newSlot] }) }
    }
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body))
      posted.push(body)
      if (postResponse.ok) status = body.action === 'cancel' ? 'cancelled' : 'scheduled'
      return { ok: postResponse.ok, json: async () => postResponse.body }
    }
    return { ok: true, json: async () => ({ appointment: appointment() }) }
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

async function startReschedule() {
  fireEvent.click(await screen.findByRole('button', { name: 'Reschedule' }))
  fireEvent.click(await screen.findByRole('button', { name: timeLabel(newSlot) }, { timeout: 5000 }))
  fireEvent.click(screen.getAllByRole('button', { name: 'Continue' })[0])
}

describe('manage booking page', () => {
  it('shows the appointment without fetching availability until Reschedule', async () => {
    render(<ManageBookingClient token="tok" />)
    expect(await screen.findByRole('heading', { name: 'Discovery Call' })).toBeTruthy()
    expect(screen.getByText(/Hi Mary, need to change plans/)).toBeTruthy()
    expect(availabilityCalls).toBe(0)
  })

  it('reschedules through pick → confirm and shows the moved screen', async () => {
    render(<ManageBookingClient token="tok" />)
    await startReschedule()
    expect(screen.getByRole('heading', { name: 'Confirm your new time' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Move my appointment' }))
    expect(await screen.findByText('Your appointment has moved')).toBeTruthy()
    expect(posted).toEqual([{ action: 'reschedule', startTime: newSlot }])
  })

  it('returns to the calendar with the time cleared when the slot was taken', async () => {
    postResponse = { ok: false, body: { ok: false, code: 'slot_taken', error: 'That time was just booked.' } }
    render(<ManageBookingClient token="tok" />)
    await startReschedule()
    fireEvent.click(screen.getByRole('button', { name: 'Move my appointment' }))
    expect(await screen.findByText('That time was just booked.')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Confirm your new time' })).toBeNull()
    const time = await screen.findByRole('button', { name: timeLabel(newSlot) }, { timeout: 5000 })
    expect(time.getAttribute('aria-pressed')).toBe('false')
  })

  it('cancels after confirmation and offers to book again', async () => {
    render(<ManageBookingClient token="tok" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel appointment' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel it' }))
    expect(await screen.findByText('Appointment cancelled')).toBeTruthy()
    expect(posted).toEqual([{ action: 'cancel' }])
    expect(screen.getByRole('link', { name: 'Book a new time' }).getAttribute('href')).toBe('/book/discovery-call')
  })

  it('keeps the appointment when the client backs out of cancelling', async () => {
    render(<ManageBookingClient token="tok" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel appointment' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep appointment' }))
    expect(screen.getByRole('button', { name: 'Reschedule' })).toBeTruthy()
    expect(posted).toEqual([])
  })

  it('explains an invalid link', async () => {
    vi.mocked(fetch).mockImplementation(async () => ({ ok: false, json: async () => ({}) }) as Response)
    render(<ManageBookingClient token="bad" />)
    expect(await screen.findByText('Booking not found')).toBeTruthy()
  })
})
