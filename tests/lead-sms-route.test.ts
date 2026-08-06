import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveLeadSmsTarget = vi.fn()
const sendOutboundSms = vi.fn()

vi.mock('@/lib/apiAuth', () => ({
  requireAdmin: vi.fn(async () => ({
    err: null,
    userId: 'user-1',
    user: {
      email: 'staff@example.com',
      user_metadata: { full_name: 'Staff User' },
    },
  })),
}))

vi.mock('@/lib/communications/config', () => ({ isSmsConfigured: () => true }))

vi.mock('@/lib/sms/outbound', () => ({
  resolveLeadSmsTarget: (...args: unknown[]) => resolveLeadSmsTarget(...args),
  sendOutboundSms: (...args: unknown[]) => sendOutboundSms(...args),
}))

import { POST } from '@/app/api/admin/leads/[id]/send-sms/route'

beforeEach(() => {
  resolveLeadSmsTarget.mockReset()
  sendOutboundSms.mockReset()
  resolveLeadSmsTarget.mockResolvedValue({
    target: {
      recipientName: 'Avery Stone',
      recipientRole: 'client',
      phone: '+15555550123',
      matterId: null,
      leadId: 'lead-1',
    },
    error: null,
  })
  sendOutboundSms.mockResolvedValue({
    ok: true,
    status: 'queued',
    providerMessageId: 'SM123',
    smsMessage: { id: 'sms-1' },
    activity: { id: 'activity-1' },
  })
})

describe('lead send-sms route', () => {
  it('uses the shared target resolver and outbound pipeline', async () => {
    const request = new Request('http://localhost/api/admin/leads/lead-1/send-sms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'Hello there' }),
    })

    const response = await POST(request as never, {
      params: Promise.resolve({ id: 'lead-1' }),
    })

    expect(resolveLeadSmsTarget).toHaveBeenCalledWith('lead-1', { includeLinkedMatter: true })
    expect(sendOutboundSms).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: 'lead-1' }),
      'Hello there',
      { id: 'user-1', email: 'staff@example.com', name: 'Staff User' },
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      status: 'queued',
      providerMessageId: 'SM123',
    })
  })

  it('preserves resolver and provider failure status codes', async () => {
    resolveLeadSmsTarget.mockResolvedValueOnce({ target: null, error: 'Lead not found' })
    const missing = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ body: 'Hello' }),
      }) as never,
      { params: Promise.resolve({ id: 'missing' }) },
    )
    expect(missing.status).toBe(404)

    sendOutboundSms.mockResolvedValueOnce({ ok: false, error: 'Provider failed', status: 502 })
    const failed = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ body: 'Hello' }),
      }) as never,
      { params: Promise.resolve({ id: 'lead-1' }) },
    )
    expect(failed.status).toBe(502)
  })

  it('keeps the lead-specific 300-character limit ahead of the shared pipeline', async () => {
    const accepted = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ body: 'a'.repeat(300) }),
      }) as never,
      { params: Promise.resolve({ id: 'lead-1' }) },
    )
    expect(accepted.status).toBe(200)

    const rejected = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ body: 'a'.repeat(301) }),
      }) as never,
      { params: Promise.resolve({ id: 'lead-1' }) },
    )
    expect(rejected.status).toBe(400)
    expect(sendOutboundSms).toHaveBeenCalledTimes(1)
  })
})
