import fs from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseBookingPrefill } from '@/lib/bookings/prefill'
import { resolveBookingLink } from '@/lib/bookings/bookingLink'

const types = vi.hoisted(() => [
  { key: 'discovery_call', slug: 'discovery-call', label: 'Discovery Call', active: true, public: true },
  { key: 'client_call', slug: 'client-call', label: 'Client Call', active: true, public: false },
  { key: 'draft_review', slug: 'draft-review', label: 'Draft Review', active: false, public: true },
])
const loadBookingAttendee = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => null as Record<string, string> | null))

vi.mock('@/lib/appointments/settings', () => ({
  getAppointmentTypeByKey: vi.fn(async (key: string) => types.find(type => type.key === key) ?? null),
}))
vi.mock('@/lib/appointments/bookingAttendee', () => ({
  loadBookingAttendee: (...a: unknown[]) => loadBookingAttendee(...a),
}))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({}) }))
// An outside scheduler configured in Settings must not be used.
vi.mock('@/lib/calendly/links', () => ({
  getCalendlyUrls: vi.fn(async () => ({ discovery_call: 'https://calendly.com/aubreylaw/discovery' })),
}))

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_PORTAL_URL', 'https://portal.example.com')
  loadBookingAttendee.mockReset()
  loadBookingAttendee.mockResolvedValue(null)
})
afterEach(() => vi.unstubAllEnvs())

describe('resolveBookingLink', () => {
  it('sends the firm booking page, not the outside scheduler, with the client filled in', async () => {
    const link = await resolveBookingLink({ meetingTypeKey: 'discovery_call', name: 'Avery Q Stone', email: 'avery@example.com' })
    expect(link.via).toBe('booking_page')
    expect(link.label).toBe('Discovery Call')
    const url = new URL(link.url)
    expect(`${url.origin}${url.pathname}`).toBe('https://portal.example.com/book/discovery-call')
    expect(url.search).toBe('')
    expect(parseBookingPrefill(url.hash)).toEqual({ firstName: 'Avery Q', lastName: 'Stone', email: 'avery@example.com', phone: null })
    expect(loadBookingAttendee).not.toHaveBeenCalled()
  })

  it('uses the stored name parts of a known lead', async () => {
    loadBookingAttendee.mockResolvedValue({ firstName: 'Mary Jane', lastName: 'van Buren', email: 'mj@example.com', phone: '+15555550123' })
    const link = await resolveBookingLink({ meetingTypeKey: 'discovery_call', name: 'Mary Jane van Buren', email: 'typed@example.com', leadId: 'lead-1' })
    expect(loadBookingAttendee).toHaveBeenCalledWith({}, { leadId: 'lead-1' })
    expect(parseBookingPrefill(new URL(link.url).hash)).toEqual({ firstName: 'Mary Jane', lastName: 'van Buren', email: 'typed@example.com', phone: '+15555550123' })
  })

  it('refuses a portal-only type unless asked for the portal Schedule page', async () => {
    await expect(resolveBookingLink({ meetingTypeKey: 'client_call', name: null, email: 'a@example.com', matterId: 'm-1' }))
      .rejects.toThrow('booked from the client portal')
    const link = await resolveBookingLink({ meetingTypeKey: 'client_call', name: null, email: 'a@example.com', matterId: 'm-1', portalOnly: 'schedule' })
    expect(link).toEqual({ url: 'https://portal.example.com/schedule', label: 'Client Call', via: 'portal' })
  })

  it('refuses an unknown or inactive type', async () => {
    await expect(resolveBookingLink({ meetingTypeKey: 'nope', name: null, email: null })).rejects.toThrow('No booking page')
    await expect(resolveBookingLink({ meetingTypeKey: 'draft_review', name: null, email: null })).rejects.toThrow('No booking page')
  })
})

describe('callers', () => {
  it('annual review sends portal clients to Schedule and others to a reply', () => {
    const source = fs.readFileSync('lib/annualReview/server.ts', 'utf8')
    expect(source).toContain("portalOnly: candidate.hasPortalAccount ? 'schedule' : 'refuse'")
  })

  it('no longer reads outside scheduler URLs', () => {
    expect(fs.readFileSync('lib/bookings/bookingLink.ts', 'utf8')).not.toContain('calendly')
  })
})
