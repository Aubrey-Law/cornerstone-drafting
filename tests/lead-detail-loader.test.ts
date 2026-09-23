import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Relative to the run, so the "still ahead" cases stay ahead. */
const FUTURE = new Date(Date.now() + 9 * 86_400_000).toISOString()
const PAST = new Date(Date.now() - 7 * 86_400_000).toISOString()
const OLDER_PAST = new Date(Date.now() - 30 * 86_400_000).toISOString()

const harness = vi.hoisted(() => {
  const rawLead = {
    id: '11111111-2222-4333-8444-555555555555',
    first_name: 'Jane',
    last_name: 'Doe',
    lead_status: 'lead',
    // Set by the meeting cases below, which need the lead to have a matter.
    matter_id: null as string | null,
  }
  const hydratedLead = {
    ...rawLead,
    _spouse: { first_name: 'John', last_name: 'Doe', date_of_birth: '1981-01-01' },
    _children: [{ first_name: 'Sam', last_name: 'Doe', date_of_birth: '2014-01-01' }],
    _fid_personal_rep_client: [{ first_name: 'Pat', last_name: 'Representative' }],
  }
  const activity = [{
    id: 'activity-1',
    title: 'Lead updated',
    actor_id: 'user-1',
    created_at: '2026-07-20T09:00:00Z',
  }]
  const notes = [{
    id: 'note-1',
    body: 'Internal note',
    actor_id: 'user-1',
    created_at: '2026-07-21T09:00:00Z',
    updated_at: '2026-07-21T09:00:00Z',
  }]
  const meetings = [{
    id: 'meeting-1',
    title: 'Discovery call',
    meeting_date: '2026-07-22T09:00:00Z',
    attendees: ['Jane Doe'],
    body: 'Meeting note',
    source: 'manual',
    granola_note_id: null,
    actor_id: 'user-2',
    created_at: '2026-07-22T10:00:00Z',
    updated_at: '2026-07-22T10:00:00Z',
  }]
  const rows: Record<string, unknown> = {
    client_intake: rawLead,
    contacts: null,
    lead_activity: activity,
    lead_notes: notes,
    lead_meeting_notes: meetings,
    appointments: { start_time: '2026-07-30T14:00:00Z' },
    users: [
      { id: 'user-1', display_name: 'Alice Attorney', email: 'alice@example.com' },
      { id: 'user-2', display_name: null, email: 'ben@example.com' },
    ],
  }
  const errors: Record<string, { message: string } | null> = {}
  const inCalls: { table: string; column: string; values: string[] }[] = []
  let currentUser: { id: string } | null = null
  const admin = {
    from: vi.fn((table: string) => {
      const result = () => ({
        data: errors[table] ? null : rows[table] ?? [],
        error: errors[table] ?? null,
      })
      const chain = {
        select: () => chain,
        eq: () => chain,
        gte: () => chain,
        neq: () => chain,
        is: () => chain,
        order: () => chain,
        limit: () => chain,
        in: (column: string, values: string[]) => {
          inCalls.push({ table, column, values })
          return chain
        },
        maybeSingle: async () => result(),
        // A lead with a matter reaches fetchMatter, which ends in `.single()`.
        single: async () => result(),
        then: (
          resolve: (value: ReturnType<typeof result>) => unknown,
          reject: (reason: unknown) => unknown,
        ) => Promise.resolve(result()).then(resolve, reject),
      }
      return chain
    }),
  }
  return {
    admin,
    hydrate: vi.fn(async () => hydratedLead),
    hydratedLead,
    rawLead,
    errors,
    rows,
    inCalls,
    get currentUser() { return currentUser },
    set currentUser(value) { currentUser = value },
  }
})

vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => harness.admin }))
vi.mock('@/lib/supabaseServer', () => ({
  createServerSupabase: async () => ({ auth: { getUser: async () => ({ data: { user: harness.currentUser } }) } }),
  getCachedUserRole: vi.fn(async () => 'attorney'),
}))
vi.mock('@/lib/appointments/settings', () => ({
  getSchedulingSettings: vi.fn(async () => ({ timezone: 'America/Los_Angeles' })),
}))
vi.mock('@/lib/intakeContactHydration', () => ({ hydrateIntakeWithContacts: harness.hydrate }))
vi.mock('@/lib/queries/tasks', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/queries/tasks')>(),
  fetchRecordTaskCounts: vi.fn(async () => ({ open: 603, overdue: 301 })),
}))
vi.mock('next/navigation', () => ({ notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }) }))
vi.mock('@/app/admin/leads/[id]/LeadDetailClient', () => ({ LeadDetailClient: () => null }))

import LeadDetailPage from '@/app/admin/leads/[id]/page'

describe('LeadDetailPage intake loader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    harness.currentUser = null
    harness.inCalls.splice(0)
    harness.rows.users = [
      { id: 'user-1', display_name: 'Alice Attorney', email: 'alice@example.com' },
      { id: 'user-2', display_name: null, email: 'ben@example.com' },
    ]
    for (const table of Object.keys(harness.errors)) delete harness.errors[table]
  })

  it('returns not found for a malformed lead ID before starting database reads', async () => {
    await expect(LeadDetailPage({ params: Promise.resolve({ id: 'bad,id' }) })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(harness.admin.from).not.toHaveBeenCalled()
  })

  it('hydrates contact-backed household and fiduciary intake data before rendering the lead client', async () => {
    const page = await LeadDetailPage({ params: Promise.resolve({ id: '11111111-2222-4333-8444-555555555555' }) })

    expect(harness.hydrate).toHaveBeenCalledWith(harness.admin, harness.rawLead)
    expect((page.props as { lead: unknown }).lead).toBe(harness.hydratedLead)
    expect(page.props).toMatchObject({
      initialTaskCounts: { open: 603, overdue: 301 },
      actorNames: {
        'user-1': 'Alice Attorney',
        'user-2': 'ben@example.com',
      },
      nextAppointmentAt: '2026-07-30T14:00:00Z',
      // Internal record edits and note creation are not client contact.
      lastTouchAt: null,
      lastClientResponseAt: null,
    })
  })

  it('passes a visible actor warning while retaining the loaded timeline rows when actor lookup fails', async () => {
    harness.errors.users = { message: 'actor lookup failed' }

    const page = await LeadDetailPage({ params: Promise.resolve({ id: '11111111-2222-4333-8444-555555555555' }) })

    expect(page.props).toMatchObject({
      initialActivity: [expect.objectContaining({ id: 'activity-1' })],
      actorNames: {},
      actorError: 'actor lookup failed',
    })
  })

  it('loads the current user name in the actor batch and passes the configured firm timezone', async () => {
    harness.currentUser = { id: 'current-user' }
    harness.rows.users = [
      { id: 'user-1', display_name: 'Alice Attorney', email: 'alice@example.com' },
      { id: 'user-2', display_name: null, email: 'ben@example.com' },
      { id: 'current-user', display_name: 'Current Attorney', email: 'current@example.com' },
    ]

    const page = await LeadDetailPage({ params: Promise.resolve({ id: '11111111-2222-4333-8444-555555555555' }) })

    expect(page.props).toMatchObject({
      actorNames: { 'current-user': 'Current Attorney' },
      currentUser: { id: 'current-user', role: 'attorney' },
      firmTimezone: 'America/Los_Angeles',
    })
    expect(harness.inCalls).toContainEqual({
      table: 'users',
      column: 'id',
      values: expect.arrayContaining(['current-user']),
    })
  })
})

/**
 * The detail page read `appointments`, which only ever holds a booking made
 * through the scheduler. `v_lead_list` reads the milestone anchors on the
 * matter row instead — `lead_scoring_appointment_at()`, the SQL mirror of
 * `scoringAppointmentAt()` — so on 2026-08-24, with 15 of 37 active leads
 * carrying a meeting and no appointment row, the same lead read "Meeting in 9
 * days" on its card and "No meeting on the calendar" on its own page, and
 * scored ten points lower there.
 */
describe('the meeting the detail page can see', () => {
  beforeEach(() => {
    harness.rawLead.matter_id = 'matter-1'
    harness.rows.matters = { discovery_call_at: null, pmps_at: null }
    harness.rows.appointments = null
  })

  afterEach(() => {
    harness.rawLead.matter_id = null
    delete harness.rows.matters
    harness.rows.appointments = { start_time: '2026-07-30T14:00:00Z' }
  })

  it('falls back to the planning session the matter row carries', async () => {
    harness.rows.matters = { discovery_call_at: null, pmps_at: FUTURE }

    const page = await LeadDetailPage({ params: Promise.resolve({ id: '11111111-2222-4333-8444-555555555555' }) })

    expect(page.props).toMatchObject({ nextAppointmentAt: FUTURE })
  })

  it('prefers a real booking, which is the calendar and is always ahead', async () => {
    harness.rows.appointments = { start_time: '2026-07-30T14:00:00Z' }
    harness.rows.matters = { discovery_call_at: null, pmps_at: FUTURE }

    const page = await LeadDetailPage({ params: Promise.resolve({ id: '11111111-2222-4333-8444-555555555555' }) })

    expect(page.props).toMatchObject({ nextAppointmentAt: '2026-07-30T14:00:00Z' })
  })

  it('takes the soonest meeting still ahead when both anchors are set', async () => {
    // The rule `scoringAppointmentAt` states and the list already applies: a
    // held discovery call must not outrank a session still to come.
    harness.rows.matters = { discovery_call_at: PAST, pmps_at: FUTURE }

    const page = await LeadDetailPage({ params: Promise.resolve({ id: '11111111-2222-4333-8444-555555555555' }) })

    expect(page.props).toMatchObject({ nextAppointmentAt: FUTURE })
  })

  it('reports the most recent meeting held when none is ahead', async () => {
    // Not "no meeting": the score credits a call already held, at half.
    harness.rows.matters = { discovery_call_at: OLDER_PAST, pmps_at: PAST }

    const page = await LeadDetailPage({ params: Promise.resolve({ id: '11111111-2222-4333-8444-555555555555' }) })

    expect(page.props).toMatchObject({ nextAppointmentAt: PAST })
  })

  it('stays null for a lead with neither a booking nor a milestone', async () => {
    const page = await LeadDetailPage({ params: Promise.resolve({ id: '11111111-2222-4333-8444-555555555555' }) })

    expect(page.props).toMatchObject({ nextAppointmentAt: null })
  })
})

describe('lead detail contact and score inputs', () => {
  it('uses the canonical list score inputs without detail readiness or calendar overrides', async () => {
    harness.rows.v_lead_list = { ...harness.rawLead, last_activity_at: '2026-07-20T09:00:00Z', next_appointment_at: '2026-08-01T09:00:00Z', updated_at: '2026-07-23T09:00:00Z' }
    const page = await LeadDetailPage({ params: Promise.resolve({ id: harness.rawLead.id }) })
    expect(page.props.initialScoreInput).toMatchObject({ lastTouchAt: '2026-07-20T09:00:00Z', nextAppointmentAt: '2026-08-01T09:00:00Z', readinessPercent: null })
    delete harness.rows.v_lead_list
  })
})

it('separates inbound responses from outbound contact and ignores later internal notes', async () => {
  const original = harness.rows.lead_activity
  harness.rows.lead_activity = [
    { id: 'out', event_type: 'email_sent', created_at: '2026-07-20T09:00:00Z' },
    { id: 'in', event_type: 'sms_received', created_at: '2026-07-19T09:00:00Z' },
    { id: 'edit', event_type: 'lead_updated', created_at: '2026-07-23T09:00:00Z' },
    { id: 'note', event_type: 'note', created_at: '2026-07-24T09:00:00Z' },
  ]
  try {
    const page = await LeadDetailPage({ params: Promise.resolve({ id: harness.rawLead.id }) })
    expect(page.props).toMatchObject({ lastTouchAt: '2026-07-20T09:00:00Z', lastClientResponseAt: '2026-07-19T09:00:00Z' })
  } finally { harness.rows.lead_activity = original }
})

it('includes accepted email send records and inbound SMS even when no activity row was written', async () => {
  harness.rows.email_log = [{ sent_at: '2026-07-24T09:00:00Z', status: 'sent' }]
  harness.rows.sms_messages = [{ created_at: '2026-07-23T09:00:00Z', direction: 'inbound' }]
  try {
    const page = await LeadDetailPage({ params: Promise.resolve({ id: harness.rawLead.id }) })
    expect(page.props).toMatchObject({ lastTouchAt: '2026-07-24T09:00:00Z', lastClientResponseAt: '2026-07-23T09:00:00Z' })
  } finally {
    delete harness.rows.email_log
    delete harness.rows.sms_messages
  }
})

it('falls back to email log creation time when a sent record has no sent_at timestamp', async () => {
  harness.rows.email_log = [{ sent_at: null, created_at: '2026-07-24T09:00:00Z' }]
  try {
    const page = await LeadDetailPage({ params: Promise.resolve({ id: harness.rawLead.id }) })
    expect(page.props.lastTouchAt).toBe('2026-07-24T09:00:00Z')
  } finally { delete harness.rows.email_log }
})
