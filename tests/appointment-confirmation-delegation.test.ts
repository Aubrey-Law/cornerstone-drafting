import fs from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The delegation dial on appointment confirmations. A client who just booked
 * expects the email at once, so these pin down the Act-and-report default,
 * the fallback to a direct send when the dial cannot be reached, and that an
 * acting position goes through the shared registry action.
 */

const mocks = vi.hoisted(() => ({
  resolveUnattendedActor: vi.fn(),
  createActionProposal: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/actions/delegation', () => ({ resolveUnattendedActor: mocks.resolveUnattendedActor }))
vi.mock('@/lib/actions/server', () => ({ createActionProposal: mocks.createActionProposal }))

import { confirmationSummary, delegateAppointmentConfirmation } from '@/lib/appointments/delegateConfirmation'
import { attendeeFirstName, buildAppointmentConfirmationEmail } from '@/lib/appointments/confirmationEmail'
import { defaultAutonomyForAction } from '@/lib/actions/autonomy'
import { getActionDefinition } from '@/lib/actions/registry'

const input = {
  appointmentId: '00000000-0000-0000-0000-000000000040',
  event: 'booked' as const,
  manageToken: 'tok_abcdefghijklmnopqrstuvwxyz0123456789',
  attendeeName: 'Pat Client',
  typeLabel: 'Discovery call',
  when: 'Monday, October 12, 2026 at 10:00 AM EDT',
  leadId: '00000000-0000-0000-0000-000000000041',
  matterId: null,
  actorId: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveUnattendedActor.mockResolvedValue({ id: 'attorney-1' })
  mocks.createActionProposal.mockResolvedValue({ autonomy: 'act_report', duplicate: false, execution: { status: 'succeeded' } })
})

describe('the confirmation action starts switched on', () => {
  it('defaults to Act and report, unlike every other action', () => {
    expect(defaultAutonomyForAction('appointment.confirmation.send')).toBe('act_report')
    expect(defaultAutonomyForAction('email.triage.reply.send')).toBe('propose')
    expect(defaultAutonomyForAction('task.create')).toBe('propose')
  })

  it('is an external write with no undo and a bounded manage token', () => {
    const definition = getActionDefinition('appointment.confirmation.send')
    expect(definition?.risk).toBe('external_write')
    expect(definition?.undo).toBeUndefined()
    expect(definition?.validate({ appointmentId: input.appointmentId, event: 'booked', manageToken: 'bad token!' }, { id: 'u' }))
      .toMatchObject({ manageToken: null })
    expect(() => definition?.validate({ appointmentId: input.appointmentId, event: 'cancelled' }, { id: 'u' })).toThrow('booked or rescheduled')
  })
})

describe('delegating a confirmation', () => {
  it('sends through the registry action as the firm attorney for a client booking', async () => {
    expect(await delegateAppointmentConfirmation(input)).toBe('sent')
    expect(mocks.createActionProposal).toHaveBeenCalledWith(expect.objectContaining({
      actionKey: 'appointment.confirmation.send',
      referencePayload: { appointmentId: input.appointmentId, event: 'booked', manageToken: input.manageToken },
      recordType: 'lead',
      recordId: input.leadId,
      source: 'automation',
      applyAutonomy: true,
      displaySummary: `Confirm the Discovery call with Pat Client on ${input.when}`,
    }), { id: 'attorney-1' })
  })

  it('sends as the staff member who booked it, without resolving another actor', async () => {
    await delegateAppointmentConfirmation({ ...input, actorId: 'staff-2' })
    expect(mocks.resolveUnattendedActor).not.toHaveBeenCalled()
    expect(mocks.createActionProposal).toHaveBeenCalledWith(expect.anything(), { id: 'staff-2' })
  })

  it('falls back to a direct send when nobody can be resolved to act as', async () => {
    mocks.resolveUnattendedActor.mockResolvedValue(null)
    expect(await delegateAppointmentConfirmation(input)).toBe('fallback')
    expect(mocks.createActionProposal).not.toHaveBeenCalled()
  })

  it('falls back to a direct send when the action service is unreachable', async () => {
    mocks.createActionProposal.mockRejectedValue(new Error('relation "action_proposals" does not exist'))
    expect(await delegateAppointmentConfirmation(input)).toBe('fallback')
  })

  it('holds the email for a click at Propose and records it at Observe', async () => {
    mocks.createActionProposal.mockResolvedValue({ autonomy: 'propose', duplicate: false, execution: null })
    expect(await delegateAppointmentConfirmation(input)).toBe('proposed')
    mocks.createActionProposal.mockResolvedValue({ autonomy: 'observe', duplicate: false, execution: null })
    expect(await delegateAppointmentConfirmation(input)).toBe('observed')
  })

  it('reports a failed send as failed rather than sending twice', async () => {
    mocks.createActionProposal.mockResolvedValue({ autonomy: 'act_report', duplicate: false, execution: { status: 'failed' } })
    expect(await delegateAppointmentConfirmation(input)).toBe('failed')
  })

  it('names the appointment in plain words', () => {
    expect(confirmationSummary({ ...input, event: 'rescheduled' })).toBe(`Confirm the rescheduled Discovery call with Pat Client on ${input.when}`)
  })
})

describe('one builder for the booking call and the action', () => {
  it('includes the manage link only when a token is given', () => {
    const type = { label: 'Discovery call', locationType: 'phone' as const }
    const base = { type, startIso: '2026-10-12T14:00:00Z', timezone: 'America/New_York', officeAddress: null, meetingUrl: null, meetingProvider: null }
    const withLink = buildAppointmentConfirmationEmail({ ...base, manageToken: 'abc', event: 'booked' })
    const withoutLink = buildAppointmentConfirmationEmail({ ...base, manageToken: null, event: 'rescheduled' })
    expect(withLink.html).toContain('/book/manage/abc')
    expect(withLink.subject).toMatch(/^Appointment confirmed: Discovery call/)
    expect(withoutLink.html).not.toContain('/book/manage/')
    expect(withoutLink.subject).toMatch(/^Appointment rescheduled/)
  })

  it('renders the branded layout for every format, escaped and personalized', () => {
    const base = { startIso: '2026-10-12T14:00:00Z', timezone: 'America/New_York', officeAddress: null, meetingUrl: null, meetingProvider: null, manageToken: null }
    const inPerson = buildAppointmentConfirmationEmail({ ...base, type: { label: 'Plan <Design>', locationType: 'in_person' }, event: 'booked', firstName: 'Margaret' })
    expect(inPerson.html).toMatch(/^<!DOCTYPE html>/)
    expect(inPerson.html).toContain("You're all set, Margaret.")
    expect(inPerson.html).toContain('Plan &lt;Design&gt;')
    expect(inPerson.html).not.toContain('Plan <Design>')
    expect(inPerson.html).toContain('1329 Highland Ave, Needham, MA 02492')
    expect(inPerson.html).toContain('Monday, October 12, 2026')
    expect(inPerson.html).toContain('10:00 AM EDT')
    const meet = buildAppointmentConfirmationEmail({ ...base, type: { label: 'Signing', locationType: 'teams' }, meetingUrl: 'https://meet.google.com/x?a=1&b=2', event: 'booked' })
    expect(meet.html).toContain('Video call — Google Meet')
    expect(meet.html).toContain('https://meet.google.com/x?a=1&amp;b=2')
    expect(meet.html).toContain("You're all set.")
    const noLink = buildAppointmentConfirmationEmail({ ...base, type: { label: 'Signing', locationType: 'teams' }, event: 'booked' })
    expect(noLink.html).toContain('The meeting link is in your calendar invitation')
    const msTeams = buildAppointmentConfirmationEmail({ ...base, type: { label: 'Review', locationType: 'phone' }, meetingUrl: 'https://teams.microsoft.com/l/x', meetingProvider: 'microsoft_teams', event: 'booked' })
    expect(msTeams.html).toContain('Video call — Microsoft Teams')
    const phone = buildAppointmentConfirmationEmail({ ...base, type: { label: 'Review', locationType: 'phone' }, event: 'rescheduled', firstName: 'Pat' })
    expect(phone.html).toContain('We will call the number you provided')
    expect(phone.html).toContain('Your new time is set, Pat.')
    expect(phone.html).toContain('Appointment rescheduled')
  })

  it('takes the headline name from the attendee', () => {
    expect(attendeeFirstName('  Margaret  Ann Smith ')).toBe('Margaret')
    expect(attendeeFirstName('')).toBeNull()
    expect(attendeeFirstName(null)).toBeNull()
  })

  it('is what the booking path falls back to, and what the action sends', () => {
    const book = fs.readFileSync('lib/appointments/book.ts', 'utf8')
    expect(book).toContain("delegateAppointmentConfirmation({")
    expect(book).toContain("if (delegated === 'fallback') {")
    expect(book).toContain('buildAppointmentConfirmationEmail({')
    // The internal alert to the firm is not an external write and stays direct.
    expect(book).toContain("category: 'appointment_booked_alert'")
    const registry = fs.readFileSync('lib/actions/registry.ts', 'utf8')
    const action = registry.slice(registry.indexOf("key: 'appointment.confirmation.send'"), registry.indexOf("key: 'task.delegate'"))
    expect(action).toContain("await import('@/lib/appointments/confirmationEmail')")
    expect(action).toContain("if (ctx.appointment.status !== 'scheduled') throw")
  })
})
