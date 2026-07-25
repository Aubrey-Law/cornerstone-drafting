import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => {
  const rawLead = {
    id: 'lead-1',
    first_name: 'Jane',
    last_name: 'Doe',
    lead_status: 'lead',
    matter_id: null,
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
  const calls = [{
    id: 'call-1',
    direction: 'inbound',
    status: 'completed',
    participant_number: '+16175550100',
    started_at: '2026-07-23T11:00:00Z',
    duration_seconds: 120,
    recording_url: null,
    voicemail_url: null,
    summary: null,
    firm_user_email: 'attorney@example.com',
  }]
  const rows: Record<string, unknown> = {
    client_intake: rawLead,
    contacts: null,
    lead_activity: activity,
    lead_notes: notes,
    lead_meeting_notes: meetings,
    appointments: { start_time: '2026-07-30T14:00:00Z' },
    calls,
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
        order: () => chain,
        limit: () => chain,
        in: (column: string, values: string[]) => {
          inCalls.push({ table, column, values })
          return chain
        },
        maybeSingle: async () => result(),
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
    calls,
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
vi.mock('next/navigation', () => ({ notFound: vi.fn() }))
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

  it('hydrates contact-backed household and fiduciary intake data before rendering the lead client', async () => {
    const page = await LeadDetailPage({ params: Promise.resolve({ id: 'lead-1' }) })

    expect(harness.hydrate).toHaveBeenCalledWith(harness.admin, harness.rawLead)
    expect((page.props as { lead: unknown }).lead).toBe(harness.hydratedLead)
    expect(page.props).toMatchObject({
      initialCalls: harness.calls,
      actorNames: {
        'user-1': 'Alice Attorney',
        'user-2': 'ben@example.com',
      },
      nextAppointmentAt: '2026-07-30T14:00:00Z',
      lastTouchAt: '2026-07-23T11:00:00Z',
    })
  })

  it('passes a visible actor warning while retaining the loaded timeline rows when actor lookup fails', async () => {
    harness.errors.users = { message: 'actor lookup failed' }

    const page = await LeadDetailPage({ params: Promise.resolve({ id: 'lead-1' }) })

    expect(page.props).toMatchObject({
      initialActivity: [expect.objectContaining({ id: 'activity-1' })],
      initialCalls: harness.calls,
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

    const page = await LeadDetailPage({ params: Promise.resolve({ id: 'lead-1' }) })

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
