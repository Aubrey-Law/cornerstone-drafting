import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  processDueScheduledEmails: vi.fn(),
  requireAdmin: vi.fn(),
}))

vi.mock('@/lib/email/scheduled', () => ({
  processDueScheduledEmails: mocks.processDueScheduledEmails,
}))

vi.mock('@/lib/apiAuth', () => ({
  requireAdmin: mocks.requireAdmin,
}))

import { GET as runScheduledEmails } from '@/app/api/cron/scheduled-emails/route'
import { POST as scheduleEmail } from '@/app/api/admin/email/scheduled/route'

describe('scheduled email routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('CRON_SECRET', 'test-cron-secret')
    mocks.requireAdmin.mockResolvedValue({
      userId: '11111111-1111-4111-8111-111111111111',
      err: null,
    })
    mocks.processDueScheduledEmails.mockResolvedValue({
      processed: 1,
      sent: 1,
      suppressed: 0,
      failed: 0,
    })
  })

  it('rejects cron requests without the configured bearer secret', async () => {
    const response = await runScheduledEmails(
      new Request('http://localhost/api/cron/scheduled-emails'),
    )

    expect(response.status).toBe(401)
    expect(mocks.processDueScheduledEmails).not.toHaveBeenCalled()
  })

  it('runs due scheduled emails with the configured bearer secret', async () => {
    const response = await runScheduledEmails(
      new Request('http://localhost/api/cron/scheduled-emails', {
        headers: { authorization: 'Bearer test-cron-secret' },
      }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ processed: 1, sent: 1 })
    expect(mocks.processDueScheduledEmails).toHaveBeenCalledOnce()
  })

  it('rejects unresolved variables before persisting a schedule', async () => {
    const response = await scheduleEmail(
      new Request('http://localhost/api/admin/email/scheduled', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contextType: 'general',
          to: 'client@example.com',
          subject: 'Hello {{first_name}}',
          html: '<p>Ready to send.</p>',
          scheduledFor: new Date(Date.now() + 60_000).toISOString(),
        }),
      }),
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining('Resolve'),
    })
  })

  it('rejects invalid recipients and past delivery times', async () => {
    const invalidRecipient = await scheduleEmail(
      new Request('http://localhost/api/admin/email/scheduled', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contextType: 'general',
          to: 'not-an-email',
          subject: 'Hello',
          html: '<p>Ready to send.</p>',
          scheduledFor: new Date(Date.now() + 60_000).toISOString(),
        }),
      }),
    )
    expect(invalidRecipient.status).toBe(400)

    const pastTime = await scheduleEmail(
      new Request('http://localhost/api/admin/email/scheduled', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contextType: 'general',
          to: 'client@example.com',
          subject: 'Hello',
          html: '<p>Ready to send.</p>',
          scheduledFor: new Date(Date.now() - 60_000).toISOString(),
        }),
      }),
    )
    expect(pastTime.status).toBe(400)
  })
})
