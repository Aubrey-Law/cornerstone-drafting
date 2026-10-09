import { beforeEach, describe, expect, it, vi } from 'vitest'

const inserts: Array<{ table: string; values: Record<string, unknown> }> = []
const sendEmail = vi.fn(async (..._args: unknown[]) => ({ ok: true, status: 'sent', logId: 'log-1' }))
const sendOutboundSms = vi.fn(async (..._args: unknown[]) => ({ ok: true, status: 'queued', providerMessageId: 'SM1', smsMessage: {}, activity: null }))
const notifyClientOfFirmMessage = vi.fn(async (..._args: unknown[]) => undefined)
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

vi.stubEnv('NEXT_PUBLIC_PORTAL_URL', 'https://portal.example.com')

vi.mock('@/lib/appointments/settings', () => ({
  listAppointmentTypes: vi.fn(async () => [
    { id: 't-1', slug: 'discovery-call', label: 'Discovery Call', active: true, public: true },
    { id: 't-2', slug: 'signing', label: 'Signing Appointment', active: true, public: false },
    { id: 't-3', slug: 'retired', label: 'Retired', active: false, public: true },
  ]),
}))

vi.mock('@/lib/appointments/bookingAttendee', () => ({
  loadBookingAttendee: vi.fn(async () => ({
    firstName: 'Avery', lastName: 'Stone', email: 'avery@example.com', phone: '+15555550123',
    secondFirstName: '', secondLastName: '', secondEmail: '',
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
  it("offers the firm's own active booking pages, prefilled for the client", async () => {
    const { GET } = await import('@/app/api/admin/scheduling-links/send/route')
    const res = await GET(new Request('http://localhost/api/admin/scheduling-links/send?leadId=lead-1') as never)
    const json = await res.json()

    expect(json.recipient).toMatchObject({ name: 'Avery Stone', email: 'avery@example.com' })
    expect(json.types.map((t: { key: string }) => t.key)).toEqual(['discovery-call', 'signing'])
    const discovery = json.types.find((t: { key: string }) => t.key === 'discovery-call')
    expect(discovery.configured).toBe(true)
    expect(discovery.links.email).toBe('https://portal.example.com/book/discovery-call#first=Avery&last=Stone&email=avery%40example.com&phone=%2B15555550123')
    // Embedded on the staff host, so it is a path.
    expect(discovery.embedUrl).toMatch(/^\/book\/discovery-call#first=Avery/)
    expect(JSON.stringify(json)).not.toMatch(/calendly|lawmatics|cal\.com/i)
    // A portal-only type cannot be emailed to a lead.
    const signing = json.types.find((t: { key: string }) => t.key === 'signing')
    expect(signing).toMatchObject({ configured: false, portalOnly: true })
  })

  it('offers portal-only types for a matter, whose client can use the portal', async () => {
    const { GET } = await import('@/app/api/admin/scheduling-links/send/route')
    const res = await GET(new Request('http://localhost/api/admin/scheduling-links/send?matterId=matter-1') as never)
    const json = await res.json()
    expect(json.types.find((t: { key: string }) => t.key === 'signing')).toMatchObject({ configured: true, portalOnly: true })
  })
})

describe('POST /api/admin/scheduling-links/send', () => {
  it('sends an email link to a lead and logs lead_activity', async () => {
    const { res } = await post({
      target: { leadId: 'lead-1' },
      meetingTypeKey: 'discovery-call',
      channel: 'email',
    })

    expect(res.status).toBe(200)
    const [args] = sendEmail.mock.calls[0] as [Record<string, unknown>]
    expect(args.category).toBe('scheduling_link')
    expect(args.to).toBe('avery@example.com')
    expect(String(args.text)).toContain('https://portal.example.com/book/discovery-call')
    const activity = inserts.find(i => i.table === 'lead_activity')
    expect(activity?.values).toMatchObject({ lead_id: 'lead-1', event_type: 'email_sent' })
  })

  it('appends the link when the edited message dropped it', async () => {
    await post({
      target: { leadId: 'lead-1' },
      meetingTypeKey: 'discovery-call',
      channel: 'email',
      message: 'Custom note with no link',
    })
    const [args] = sendEmail.mock.calls[0] as [Record<string, unknown>]
    expect(String(args.text)).toContain('Custom note with no link')
    expect(String(args.text)).toContain('https://portal.example.com/book/discovery-call')
  })

  it('rejects retired SMS scheduling links without sending', async () => {
    const { res } = await post({
      target: { matterId: 'matter-1' },
      meetingTypeKey: 'signing',
      channel: 'sms',
    })
    expect(res.status).toBe(410)
    expect(sendOutboundSms).not.toHaveBeenCalled()
  })

  it('posts a portal message and notifies the client (matter only)', async () => {
    const { res } = await post({
      target: { matterId: 'matter-1' },
      meetingTypeKey: 'signing',
      channel: 'portal',
    })
    expect(res.status).toBe(200)
    const message = inserts.find(i => i.table === 'messages')
    expect(message?.values).toMatchObject({ matter_id: 'matter-1', sender_role: 'attorney' })
    expect(String(message?.values.body)).toContain('https://portal.example.com/book/signing')
    expect(notifyClientOfFirmMessage).toHaveBeenCalledWith('matter-1')
  })

  it('rejects portal channel for a lead target', async () => {
    const { res } = await post({
      target: { leadId: 'lead-1' },
      meetingTypeKey: 'discovery-call',
      channel: 'portal',
    })
    expect(res.status).toBe(400)
  })

  it('rejects an unknown or inactive appointment type', async () => {
    for (const meetingTypeKey of ['pmps', 'retired']) {
      const { res } = await post({ target: { leadId: 'lead-1' }, meetingTypeKey, channel: 'email' })
      expect(res.status).toBe(400)
    }
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('sends a portal-only type only as a portal message', async () => {
    const { res, json } = await post({ target: { matterId: 'matter-1' }, meetingTypeKey: 'signing', channel: 'email' })
    expect(res.status).toBe(400)
    expect(json.error).toContain('client portal')
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('rejects when neither or both target ids are given', async () => {
    expect((await post({ target: {}, meetingTypeKey: 'discovery-call', channel: 'email' })).res.status).toBe(400)
    expect((await post({ target: { leadId: 'a', matterId: 'b' }, meetingTypeKey: 'discovery-call', channel: 'email' })).res.status).toBe(400)
  })
})
