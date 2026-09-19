import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppointmentType } from '@/lib/appointments/types'

vi.mock('server-only', () => ({}))

const state = vi.hoisted(() => ({
  intakeRow: null as Record<string, unknown> | null,
  intakeUpdates: [] as Array<Record<string, unknown>>,
  /** Rows returned by the matters conditional update (empty = guard blocked). */
  matterUpdateResult: [] as Array<{ id: string }>,
  matterUpdates: [] as Array<{ values: Record<string, unknown>; inStages: string[] }>,
  activityInserts: [] as Array<{ table: string; values: Record<string, unknown> }>,
  emails: [] as Array<{ category: string; to: string }>,
  fired: [] as Array<{ matterId: string; matterStage: string }>,
  reset() {
    this.intakeRow = null
    this.intakeUpdates = []
    this.matterUpdateResult = []
    this.matterUpdates = []
    this.activityInserts = []
    this.emails = []
    this.fired = []
  },
}))

vi.mock('@/lib/supabaseAdmin', () => {
  function builderFor(table: string) {
    if (table === 'client_intake') {
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        maybeSingle: vi.fn(async () => ({ data: state.intakeRow, error: null })),
        update: vi.fn((values: Record<string, unknown>) => {
          state.intakeUpdates.push(values)
          const updateChain = {
            eq: vi.fn(() => updateChain),
            is: vi.fn(() => updateChain),
            then: (resolve: (v: unknown) => unknown) => resolve({ error: null }),
          }
          return updateChain
        }),
      }
      return chain
    }
    if (table === 'matters') {
      return {
        update: vi.fn((values: Record<string, unknown>) => {
          const captured = { values, inStages: [] as string[] }
          state.matterUpdates.push(captured)
          const chain = {
            eq: vi.fn(() => chain),
            in: vi.fn((_col: string, stages: string[]) => {
              captured.inStages = stages
              return chain
            }),
            select: vi.fn(async () => ({ data: state.matterUpdateResult, error: null })),
          }
          return chain
        }),
      }
    }
    return {
      insert: vi.fn((values: Record<string, unknown>) => {
        state.activityInserts.push({ table, values })
        return { then: (resolve: (v: unknown) => unknown) => resolve({ error: null }) }
      }),
    }
  }
  return {
    ADMIN_EMAIL: 'scott@aubreylegal.com',
    getAdminClient: vi.fn(() => ({ from: vi.fn((table: string) => builderFor(table)) })),
  }
})

vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn(async (args: { category: string; to: string }) => {
    state.emails.push({ category: args.category, to: args.to })
    return { ok: true, status: 'sent', providerMessageId: null, logId: null }
  }),
}))

vi.mock('@/lib/stage-engine/fireStageTasks', () => ({
  fireEngineStageTask: vi.fn(async (_admin: unknown, input: { matterId: string; matterStage: string }) => {
    state.fired.push(input)
  }),
}))

import { runPostBookingAutomation } from '@/lib/appointments/automation'

function type(key: string): AppointmentType {
  return {
    id: 't1',
    key,
    slug: key.replace(/_/g, '-'),
    label: key,
    description: '',
    durationMinutes: 30,
    locationType: 'phone',
    locationTypes: ['phone'],
    active: true,
    public: true,
    sort: 1,
    customWeeklyHours: null,
  }
}

beforeEach(() => {
  state.reset()
  vi.clearAllMocks()
})

describe('runPostBookingAutomation', () => {
  it('sends the intake invite for a lead discovery call and logs activity', async () => {
    state.intakeRow = {
      id: 'lead-1',
      email: 'pat@example.com',
      first_name: 'Pat',
      status: 'draft',
      intake_sent_at: null,
    }
    await runPostBookingAutomation({
      type: type('discovery_call'),
      leadId: 'lead-1',
      matterId: null,
      autoIntakeInvite: true,
    })
    expect(state.emails).toEqual([{ category: 'intake_invite', to: 'pat@example.com' }])
    expect(state.intakeUpdates.some(update => Boolean(update.intake_link_version))).toBe(true)
    expect(state.intakeUpdates.some(update => Boolean(update.intake_sent_at))).toBe(true)
    expect(state.activityInserts.find(i => i.table === 'lead_activity')).toBeDefined()
  })

  it('skips the invite when disabled, already sent, or already submitted', async () => {
    state.intakeRow = {
      id: 'lead-1', email: 'pat@example.com', first_name: 'Pat',
      status: 'draft', intake_sent_at: null,
    }
    await runPostBookingAutomation({
      type: type('discovery_call'), leadId: 'lead-1', matterId: null, autoIntakeInvite: false,
    })
    expect(state.emails).toHaveLength(0)

    state.intakeRow = { ...state.intakeRow, intake_sent_at: '2026-07-01T00:00:00Z' }
    await runPostBookingAutomation({
      type: type('discovery_call'), leadId: 'lead-1', matterId: null, autoIntakeInvite: true,
    })
    expect(state.emails).toHaveLength(0)

    state.intakeRow = { ...state.intakeRow, intake_sent_at: null, status: 'submitted' }
    await runPostBookingAutomation({
      type: type('discovery_call'), leadId: 'lead-1', matterId: null, autoIntakeInvite: true,
    })
    expect(state.emails).toHaveLength(0)
  })

  // The v1 path: back then the PMPS *was* the design meeting, held by a hired
  // matter in `intake`. Under v3 the session is pre-engagement and a lead's
  // stage is never one of these, so this branch cannot fire for one — that move
  // is the stamp_lead_pmps_stage trigger (tests/pmps-booking-anchor.test.ts).
  it('advances a matter to design when a PMPS is booked from intake', async () => {
    state.matterUpdateResult = [{ id: 'matter-1' }]
    await runPostBookingAutomation({
      type: type('pmps'), leadId: null, matterId: 'matter-1', autoIntakeInvite: true,
    })
    expect(state.matterUpdates[0].values.stage).toBe('design')
    expect(state.matterUpdates[0].inStages).toEqual(['intake', 'intake_review'])
    expect(state.activityInserts.find(i => i.table === 'matter_activity')).toBeDefined()
    expect(state.fired).toEqual([{ matterId: 'matter-1', matterStage: 'design' }])
  })

  it('signing appointment advances only from drafts_approved; guard blocks otherwise', async () => {
    // Guard blocked → no activity, no stage-task firing.
    state.matterUpdateResult = []
    await runPostBookingAutomation({
      type: type('signing_appointment'), leadId: null, matterId: 'matter-1', autoIntakeInvite: true,
    })
    expect(state.matterUpdates[0].values.stage).toBe('signing_scheduled')
    expect(state.matterUpdates[0].inStages).toEqual(['drafts_approved'])
    expect(state.activityInserts).toHaveLength(0)
    expect(state.fired).toHaveLength(0)
  })

  it('does nothing for types with no automation', async () => {
    await runPostBookingAutomation({
      type: type('client_call'), leadId: 'lead-1', matterId: 'matter-1', autoIntakeInvite: true,
    })
    expect(state.emails).toHaveLength(0)
    expect(state.matterUpdates).toHaveLength(0)
  })
})
