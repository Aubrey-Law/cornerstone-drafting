import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

// ── shared mock state ────────────────────────────────────────────────────────

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  updates: [] as Array<{ values: Record<string, unknown>; id: string }>,
  /** ids whose claim update should return no rows (lost race). */
  claimLosers: new Set<string>(),
  emails: [] as Array<{ category: string; to: string; cc?: string; subject: string; html: string }>,
  emailResultOk: true,
  reminderHours: 24,
  smsEnabled: false,
  smsSends: [] as Array<{ to: string; body: string }>,
  reset() {
    this.rows = []
    this.updates = []
    this.claimLosers = new Set()
    this.emails = []
    this.emailResultOk = true
    this.reminderHours = 24
    this.smsEnabled = false
    this.smsSends = []
  },
}))

vi.mock('@/lib/supabaseAdmin', () => {
  function appointmentsBuilder() {
    const filters: Record<string, unknown> = {}
    const chain = {
      select: vi.fn(() => chain),
      update: vi.fn((values: Record<string, unknown>) => {
        const updateChain = {
          eq: vi.fn((col: string, id: string) => {
            if (col === 'id') filters.id = id
            return updateChain
          }),
          is: vi.fn(() => updateChain),
          select: vi.fn(async () => {
            const id = filters.id as string
            state.updates.push({ values, id })
            return {
              data: state.claimLosers.has(id) ? [] : [{ id }],
              error: null,
            }
          }),
          then: (resolve: (v: unknown) => unknown) => {
            state.updates.push({ values, id: filters.id as string })
            return resolve({ error: null })
          },
        }
        return updateChain
      }),
      eq: vi.fn(() => chain),
      is: vi.fn(() => chain),
      gt: vi.fn(() => chain),
      lte: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(async () => ({ data: state.rows, error: null })),
    }
    return chain
  }
  return {
    ADMIN_EMAIL: 'scott@aubreylegal.com',
    getAdminClient: vi.fn(() => ({ from: vi.fn(() => appointmentsBuilder()) })),
  }
})

vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn(async (args: { category: string; to: string; subject: string; html: string }) => {
    state.emails.push(args)
    return state.emailResultOk
      ? { ok: true, status: 'sent', resendId: 'r-1', logId: null }
      : { ok: false, status: 'error', error: 'boom', logId: null }
  }),
}))

vi.mock('@/lib/firmSettings', () => ({
  loadFirmSettings: vi.fn(async () => ({
    street: '1 Main St',
    city: 'Needham',
    state: 'MA',
    zip: '02492',
  })),
}))

vi.mock('@/lib/appointments/settings', () => ({
  getSchedulingSettings: vi.fn(async () => ({
    timezone: 'America/New_York',
    weeklyHours: {},
    minNoticeHours: 0,
    horizonDays: 60,
    bufferMinutes: 0,
    reminderHoursBefore: state.reminderHours,
    bookingPaused: false,
    smsRemindersEnabled: state.smsEnabled,
    autoIntakeInvite: true,
    dateOverrides: {},
  })),
  listAppointmentTypes: vi.fn(async () => [
    {
      id: 'type-1',
      key: 'discovery_call',
      slug: 'discovery-call',
      label: 'Discovery Call',
      description: '',
      durationMinutes: 30,
      locationType: 'teams',
      locationTypes: ['teams', 'phone'],
      active: true,
      public: true,
      sort: 1,
      customWeeklyHours: null,
    },
  ]),
}))

vi.mock('@/lib/twilio/sms', () => ({
  normalizeSmsRecipient: vi.fn((v: string | null) => {
    const digits = (v ?? '').replace(/\D/g, '')
    return digits.length === 10 ? `+1${digits}` : null
  }),
  sendSmsMessage: vi.fn(async (input: { to: string; body: string }) => {
    state.smsSends.push(input)
    return { ok: true, providerMessageId: 'sms-1', status: 'queued', to: input.to }
  }),
}))

import { sendDueReminders } from '@/lib/appointments/reminders'

// ── fixtures ────────────────────────────────────────────────────────────────

const NOW = new Date('2026-08-10T12:00:00.000Z')

function dueRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'appt-1',
    appointment_type_id: 'type-1',
    start_time: '2026-08-11T10:00:00.000Z', // 22h out — inside 24h window
    attendee_name: 'Pat Client',
    attendee_email: 'pat@example.com',
    attendee_phone: '(555) 123-4567',
    second_attendee_email: null,
    online_meeting_url: 'https://teams.microsoft.com/l/meetup-join/abc',
    location_type: 'teams',
    created_at: '2026-08-01T00:00:00.000Z', // booked well before the window
    ...overrides,
  }
}

beforeEach(() => {
  state.reset()
  vi.clearAllMocks()
})

describe('sendDueReminders', () => {
  it('sends a reminder with type, time, and Teams link, and claims the row', async () => {
    state.rows = [dueRow()]
    const result = await sendDueReminders(NOW)

    expect(result).toEqual({ sent: 1, skipped: 0, failed: 0, disabled: false })
    expect(state.emails).toHaveLength(1)
    expect(state.emails[0].category).toBe('appointment_reminder')
    expect(state.emails[0].to).toBe('pat@example.com')
    expect(state.emails[0].subject).toContain('Reminder: Discovery Call')
    expect(state.emails[0].html).toContain('teams.microsoft.com')
    // Claimed exactly once, never released.
    expect(state.updates).toHaveLength(1)
    expect(state.updates[0].values.reminder_sent_at).toBeTruthy()
  })

  it('does nothing when reminders are disabled', async () => {
    state.reminderHours = 0
    state.rows = [dueRow()]
    const result = await sendDueReminders(NOW)
    expect(result.disabled).toBe(true)
    expect(state.emails).toHaveLength(0)
  })

  it('skips appointments booked inside the reminder window', async () => {
    state.rows = [dueRow({ created_at: '2026-08-10T13:00:00.000Z' })]
    const result = await sendDueReminders(NOW)
    expect(result).toEqual({ sent: 0, skipped: 1, failed: 0, disabled: false })
    expect(state.emails).toHaveLength(0)
    expect(state.updates).toHaveLength(0)
  })

  it('skips rows whose claim is lost to a concurrent run', async () => {
    state.rows = [dueRow()]
    state.claimLosers.add('appt-1')
    const result = await sendDueReminders(NOW)
    expect(result).toEqual({ sent: 0, skipped: 1, failed: 0, disabled: false })
    expect(state.emails).toHaveLength(0)
  })

  it('releases the claim when the send fails so the next run retries', async () => {
    state.rows = [dueRow()]
    state.emailResultOk = false
    const result = await sendDueReminders(NOW)

    expect(result).toEqual({ sent: 0, skipped: 0, failed: 1, disabled: false })
    // First update claims, second releases.
    expect(state.updates).toHaveLength(2)
    expect(state.updates[0].values.reminder_sent_at).toBeTruthy()
    expect(state.updates[1].values.reminder_sent_at).toBeNull()
  })

  it('also texts the reminder when SMS reminders are enabled', async () => {
    state.smsEnabled = true
    state.rows = [dueRow()]
    const result = await sendDueReminders(NOW)
    expect(result.sent).toBe(1)
    expect(state.smsSends).toHaveLength(1)
    expect(state.smsSends[0].to).toBe('+15551234567')
    expect(state.smsSends[0].body).toContain('Discovery Call')
  })

  it('sends no SMS when disabled or when there is no usable phone', async () => {
    state.rows = [dueRow()]
    await sendDueReminders(NOW)
    expect(state.smsSends).toHaveLength(0)

    state.reset()
    state.smsEnabled = true
    state.rows = [dueRow({ attendee_phone: null })]
    await sendDueReminders(NOW)
    expect(state.smsSends).toHaveLength(0)
  })

  it("cc's the spouse on the reminder email", async () => {
    state.rows = [dueRow({ second_attendee_email: 'spouse@example.com' })]
    await sendDueReminders(NOW)
    expect(state.emails[0].cc).toBe('spouse@example.com')
  })

  it('handles multiple rows independently', async () => {
    state.rows = [
      dueRow(),
      dueRow({ id: 'appt-2', attendee_email: 'sam@example.com' }),
      dueRow({ id: 'appt-3', attendee_email: '' }), // no email → skipped
    ]
    const result = await sendDueReminders(NOW)
    expect(result).toEqual({ sent: 2, skipped: 1, failed: 0, disabled: false })
    expect(state.emails.map(e => e.to)).toEqual(['pat@example.com', 'sam@example.com'])
  })
})
