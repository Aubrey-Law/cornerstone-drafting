import { beforeEach, describe, expect, it, vi } from 'vitest'
import { taskRecordLink } from '@/lib/emailTriage/taskFromThread'

describe('taskRecordLink', () => {
  it('prefers the matter when a lead row also carries a matter id', () => {
    expect(taskRecordLink({
      matter_id: 'matter-1',
      client_intake_id: 'lead-1',
      classification: 'lead',
    })).toEqual({ matter_id: 'matter-1', lead_id: null })
  })

  it('uses the lead when there is no matter', () => {
    expect(taskRecordLink({
      matter_id: null,
      client_intake_id: 'lead-1',
      classification: 'lead',
    })).toEqual({ matter_id: null, lead_id: 'lead-1' })
  })

  it('allows firm-only tasks with neither relation', () => {
    expect(taskRecordLink({
      matter_id: null,
      client_intake_id: null,
      classification: 'possible_lead',
    })).toEqual({ matter_id: null, lead_id: null })
  })
})

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  fetchRow: vi.fn(),
  insert: vi.fn(),
  logTaskActivity: vi.fn(),
}))

vi.mock('@/lib/apiAuth', () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock('@/lib/queries/emailTriage', () => ({ fetchEmailTriageRow: mocks.fetchRow }))
vi.mock('@/lib/tasks/server', () => ({
  actorFrom: () => ({ id: 'attorney-1' }),
  logTaskActivity: mocks.logTaskActivity,
}))
vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        mocks.insert(row)
        return {
          select: () => ({
            single: async () => ({
              data: {
                id: 'task-1',
                title: row.title,
                matter_id: row.matter_id ?? null,
                lead_id: row.lead_id ?? null,
                source: 'manual',
              },
              error: null,
            }),
          }),
        }
      },
    }),
  }),
}))

import { POST } from '@/app/api/admin/email-triage/[id]/task/route'

describe('POST /api/admin/email-triage/[id]/task', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAdmin.mockResolvedValue({
      userId: 'attorney-1',
      user: { id: 'attorney-1', email: 'attorney@example.com' },
    })
    mocks.logTaskActivity.mockResolvedValue(undefined)
  })

  it('does not insert both matter_id and lead_id for a hired lead thread', async () => {
    mocks.fetchRow.mockResolvedValue({
      id: 'triage-1',
      gmail_thread_id: 'g1',
      sender_email: 'pat@example.com',
      sender_name: 'Pat',
      subject: 'Signing?',
      snippet: 'Can we sign Friday?',
      matter_id: 'matter-1',
      client_intake_id: 'lead-1',
      classification: 'lead',
    })

    const res = await POST(
      new Request('https://app.test/api/admin/email-triage/triage-1/task', {
        method: 'POST',
        body: '{}',
      }),
      { params: Promise.resolve({ id: 'triage-1' }) },
    )

    expect(res.status).toBe(201)
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      matter_id: 'matter-1',
      lead_id: null,
      email_triage_thread_id: 'triage-1',
      gmail_thread_id: 'g1',
    }))
  })
})
