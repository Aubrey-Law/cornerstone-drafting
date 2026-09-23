import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IntegrationError } from '@/lib/integrations/errors'

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  inserts: [] as Array<{ table: string; values: Record<string, unknown> }>,
  matterIntake: { 'matter-1': 'lead-1', 'matter-orphan': null } as Record<string, string | null>,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/integrations/lawmatics/push', () => ({ pushLeadToLawmatics: mocks.push }))
vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: (_column: string, id: string) => ({
          maybeSingle: async () => ({
            data: table === 'matters' && id in mocks.matterIntake ? { client_intake_id: mocks.matterIntake[id] } : null,
            error: null,
          }),
        }),
      }),
      insert: async (values: Record<string, unknown>) => {
        mocks.inserts.push({ table, values })
        return { error: null }
      },
    }),
  }),
}))

import { prepareLawmaticsBooking } from '@/lib/integrations/lawmatics/bookingLink'

beforeEach(() => {
  mocks.push.mockReset()
  mocks.push.mockResolvedValue({ prospectId: 'p-1', operation: 'created' })
  mocks.inserts.length = 0
})

describe('prepareLawmaticsBooking', () => {
  it('pushes a lead and logs the push on its activity', async () => {
    expect(await prepareLawmaticsBooking({ leadId: 'lead-1', matterId: null }, 'user-1')).toEqual({
      intakeId: 'lead-1', prospectId: 'p-1', operation: 'created', warning: null,
    })
    expect(mocks.push).toHaveBeenCalledWith('lead-1')
    expect(mocks.inserts).toEqual([{ table: 'lead_activity', values: expect.objectContaining({
      lead_id: 'lead-1', event_type: 'lawmatics_pushed', title: 'Created in Lawmatics', actor_id: 'user-1',
    }) }])
  })

  it('pushes a matter through its client intake', async () => {
    await prepareLawmaticsBooking({ leadId: null, matterId: 'matter-1' }, null)
    expect(mocks.push).toHaveBeenCalledWith('lead-1')
  })

  it('warns instead of throwing when the matter has no client record', async () => {
    const result = await prepareLawmaticsBooking({ leadId: null, matterId: 'matter-orphan' }, null)
    expect(result.prospectId).toBeNull()
    expect(result.warning).toMatch(/matched by email/)
    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('turns a push failure into a staff-facing warning', async () => {
    mocks.push.mockRejectedValueOnce(new IntegrationError({
      provider: 'lawmatics', kind: 'attention', code: 'identity_required',
      safeMessage: 'Add a first and last name before pushing to Lawmatics.', retryAfterMs: null,
    }))
    const result = await prepareLawmaticsBooking({ leadId: 'lead-1', matterId: null }, 'user-1')
    expect(result).toMatchObject({ intakeId: 'lead-1', prospectId: null, operation: null })
    expect(result.warning).toBe('Add a first and last name before pushing to Lawmatics. The booking will be matched to this client by email instead.')
    expect(mocks.inserts).toEqual([])
  })

  it('does not leak unexpected error text', async () => {
    mocks.push.mockRejectedValueOnce(new Error('connection string postgres://secret'))
    const result = await prepareLawmaticsBooking({ leadId: 'lead-1', matterId: null }, null)
    expect(result.warning).not.toContain('secret')
  })
})
