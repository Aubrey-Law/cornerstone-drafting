import { beforeEach, describe, expect, it, vi } from 'vitest'

const inserts: Array<{ table: string; values: Record<string, unknown> }> = []
const sendEmail = vi.fn(async () => ({ ok: true, status: 'sent', logId: 'log-1' }))
const sendOutboundSms = vi.fn(async () => ({ ok: true, status: 'queued', providerMessageId: 'SM1', smsMessage: {}, activity: null }))
const notifyClientOfFirmMessage = vi.fn(async () => undefined)

vi.mock('@/lib/apiAuth', () => ({
  requireAdmin: vi.fn(async () => ({
    err: null,
    userId: 'user-1',
    user: { email: 'staff@example.com', user_metadata: { full_name: 'Staff' } },
  })),
}))

vi.mock('@/lib/email/send', () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }))

vi.mock('@/lib/sms/outbound', () => ({
  resolveLeadSmsTarget: vi.fn(async (leadId: string) => ({
    target: { recipientName: 'Avery Stone', recipientRole: 'client', phone: '+15555550123', matterId: null, leadId },
    error: null,
  })),
  resolveMatterSmsTarget: vi.fn(async (matterId: string) => ({
    target: { recipientName: 'Avery Stone', recipientRole: 'client', phone: '+15555550123', matterId, leadId: null },
    error: null,
  })),
  sendOutboundSms: (...a: unknown[]) => sendOutboundSms(...a),
}))

vi.mock('@/lib/communications/config', () => ({ isSmsConfigured: () => true }))
vi.mock('@/lib/portalNotifications', () => ({
  notifyClientOfFirmMessage: (...a: unknown[]) => notifyClientOfFirmMessage(...a),
}))

vi.mock('@/lib/calendly/links', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/calendly/links')>()),
  getCalendlyUrls: vi.fn(async () => ({
    discovery_call: 'https://calendly.com/aubreylaw/discovery',
    signing_appointment: 'https://calendly.com/aubreylaw/signing',
  })),
}))

vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (table === 'client_intake') {
              return { data: { id: 'lead-1', first_name: 'Avery', last_name: 'Stone', full_name: 'Avery Stone', email: 'avery@example.com', phone: '+15555550123' }, error: null }
            }
            if (table === 'v_matter_pipeline') {
              return { data: { matter_id: 'matter-1', client_name: 'Avery Stone', client_email: 'avery@example.com', client_phone: '+15555550123' }, error: null }
            }
            return { data: null, error: null }
          },
        }),
      }),
      insert: (values: Record<string, unknown>) => {
        inserts.push({ table, values })
        return { select: () => ({ single: async () => ({ data: { id: `${table}-1`, ...values }, error: null }) }) }
      },
    }),
  }),
}))

async function post(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/admin/scheduling-links/send/route')
  const res = await POST(new Request('http://localhost/api/admin/scheduling-links/send', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as never)
  return { res, json: await res.json() }
}

beforeEach(() => {
  inserts.length = 0
  sendEmail.mockClear()
  sendOutboundSms.mockClear()
  notifyClientOfFirmMessage.mockClear()
  vi.resetModules()
})

describe('GET /api/admin/scheduling-links/send', () => {
  it('returns configured types with per-channel links and embed url', async () => {
    const { GET } = await import('@/app/api/admin/scheduling-links/send/route')
    const res = await GET(new Request('http://localhost/api/admin/scheduling-links/send?leadId=lead-1') as never)
    const json = await res.json()

    expect(json.smsConfigured).toBe(true)
    expect(json.recipient).toMatchObject({ name: 'Avery Stone', email: 'avery@example.com' })
    const discovery = json.types.find((t: { key: string }) => t.key === 'discovery_call')
    expect(discovery.configured).toBe(true)
    expect(discovery.links.email).toContain('utm_medium=email')
    expect(discovery.links.email).toContain('utm_content=leadId%3Alead-1')
    expect(discovery.embedUrl).toContain('utm_medium=staff')
    const pmps = json.types.find((t: { key: string }) => t.key === 'pmps')
    expect(pmps.configured).toBe(false)
  })
})

describe('POST /api/admin/scheduling-links/send', () => {
  it('sends an email link to a lead and logs lead_activity', async () => {
    const { res } = await post({
      target: { leadId: 'lead-1' },
      meetingTypeKey: 'discovery_call',
      channel: 'email',
    })

    expect(res.status).toBe(200)
    const [args] = sendEmail.mock.calls[0] as [Record<string, unknown>]
    expect(args.category).toBe('scheduling_link')
    expect(args.to).toBe('avery@example.com')
    expect(String(args.text)).toContain('https://calendly.com/aubreylaw/discovery')
    const activity = inserts.find(i => i.table === 'lead_activity')
    expect(activity?.values).toMatchObject({ lead_id: 'lead-1', event_type: 'email_sent' })
  })

  it('appends the link when the edited message dropped it', async () => {
    await post({
      target: { leadId: 'lead-1' },
      meetingTypeKey: 'discovery_call',
      channel: 'email',
      message: 'Custom note with no link',
    })
    const [args] = sendEmail.mock.calls[0] as [Record<string, unknown>]
    expect(String(args.text)).toContain('Custom note with no link')
    expect(String(args.text)).toContain('https://calendly.com/aubreylaw/discovery')
  })

  it('sends SMS through sendOutboundSms for a matter target', async () => {
    const { res } = await post({
      target: { matterId: 'matter-1' },
      meetingTypeKey: 'signing_appointment',
      channel: 'sms',
    })
    expect(res.status).toBe(200)
    const [, body] = sendOutboundSms.mock.calls[0] as [unknown, string]
    expect(body).toContain('https://calendly.com/aubreylaw/signing')
    expect(body).toContain('utm_medium=sms')
  })

  it('posts a portal message and notifies the client (matter only)', async () => {
    const { res } = await post({
      target: { matterId: 'matter-1' },
      meetingTypeKey: 'signing_appointment',
      channel: 'portal',
    })
    expect(res.status).toBe(200)
    const message = inserts.find(i => i.table === 'messages')
    expect(message?.values).toMatchObject({ matter_id: 'matter-1', sender_role: 'attorney' })
    expect(String(message?.values.body)).toContain('https://calendly.com/aubreylaw/signing')
    expect(notifyClientOfFirmMessage).toHaveBeenCalledWith('matter-1')
  })

  it('rejects portal channel for a lead target', async () => {
    const { res } = await post({
      target: { leadId: 'lead-1' },
      meetingTypeKey: 'discovery_call',
      channel: 'portal',
    })
    expect(res.status).toBe(400)
  })

  it('rejects an unconfigured meeting type', async () => {
    const { res } = await post({
      target: { leadId: 'lead-1' },
      meetingTypeKey: 'pmps',
      channel: 'email',
    })
    expect(res.status).toBe(400)
  })

  it('rejects when neither or both target ids are given', async () => {
    expect((await post({ target: {}, meetingTypeKey: 'discovery_call', channel: 'email' })).res.status).toBe(400)
    expect((await post({ target: { leadId: 'a', matterId: 'b' }, meetingTypeKey: 'discovery_call', channel: 'email' })).res.status).toBe(400)
  })
})
