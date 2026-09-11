import { beforeEach, describe, expect, it, vi } from 'vitest'

const inserts: Array<{ table: string; values: Record<string, unknown> }> = []
const leadQuery = vi.hoisted(() => ({
  data: null as Record<string, unknown> | null,
}))

vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({
    from: (table: string) => ({
      insert: (values: Record<string, unknown>) => {
        inserts.push({ table, values })
        return {
          select: () => ({
            single: async () => ({ data: { id: `${table}-1`, ...values }, error: null }),
          }),
        }
      },
      update: () => ({
        eq: () => ({
          select: () => ({
            single: async () => ({ data: { id: 'sms_messages-1' }, error: null }),
          }),
        }),
      }),
      select: () => ({
        eq: () => ({
          not: () => ({
            maybeSingle: async () => ({ data: leadQuery.data, error: null }),
          }),
        }),
      }),
    }),
  }),
}))

vi.mock('@/lib/sms/provider', () => ({
  normalizeSmsRecipient: (phone: string | null) => phone,
  sendProviderSmsMessage: vi.fn(async () => ({
    ok: true,
    status: 'queued',
    providerMessageId: 'SM123',
  })),
}))

vi.mock('@/lib/communications/providers', () => ({ smsProvider: () => 'twilio' }))
vi.mock('@/lib/telnyx/config', () => ({ telnyxPhoneNumber: () => null }))

import { sendProviderSmsMessage } from '@/lib/sms/provider'
import { resolveLeadSmsTarget, sendOutboundSms } from '@/lib/sms/outbound'

beforeEach(() => {
  inserts.length = 0
  leadQuery.data = {
    id: 'lead-1',
    first_name: 'Avery',
    last_name: 'Stone',
    full_name: 'Avery Stone',
    phone: '+15555550123',
    matter_id: 'matter-1',
  }
})

describe('lead-target outbound SMS', () => {
  it('resolves a lead target from client_intake', async () => {
    const { target, error } = await resolveLeadSmsTarget('lead-1')
    expect(error).toBeNull()
    expect(target).toMatchObject({
      leadId: 'lead-1',
      matterId: null,
      recipientRole: 'client',
      phone: '+15555550123',
    })
    expect(target?.recipientName).toBe('Avery Stone')
  })

  it('includes the linked opportunity matter only when the caller requests route provenance', async () => {
    const { target } = await resolveLeadSmsTarget('lead-1', { includeLinkedMatter: true })
    expect(target).toMatchObject({ leadId: 'lead-1', matterId: 'matter-1' })
  })

  it('does not resolve a non-lead intake row', async () => {
    leadQuery.data = null
    const { target, error } = await resolveLeadSmsTarget('intake-only')
    expect(target).toBeNull()
    expect(error).toBe('Lead not found')
  })

  it('writes sms_messages with lead_id and logs lead_activity, not matter_activity', async () => {
    const { target } = await resolveLeadSmsTarget('lead-1', { includeLinkedMatter: true })
    const result = await sendOutboundSms(target!, 'Book here: https://calendly.com/x', {
      id: 'user-1',
      email: 'staff@example.com',
      name: 'Staff',
    })

    expect(result.ok).toBe(true)
    const smsInsert = inserts.find(i => i.table === 'sms_messages')
    expect(smsInsert?.values).toMatchObject({ lead_id: 'lead-1', matter_id: 'matter-1' })
    expect(inserts.some(i => i.table === 'lead_activity')).toBe(true)
    expect(inserts.some(i => i.table === 'matter_activity')).toBe(false)
    const activity = inserts.find(i => i.table === 'lead_activity')
    expect(activity?.values).toMatchObject({ lead_id: 'lead-1', event_type: 'sms_sent' })
  })
})

it('records a provider-rejected text as failed rather than client contact', async () => {
  vi.mocked(sendProviderSmsMessage).mockResolvedValueOnce({ ok: false, error: 'Provider rejected the message' })
  const { target } = await resolveLeadSmsTarget('lead-1')
  const result = await sendOutboundSms(target!, 'Follow up', { id: 'user-1', email: 'staff@example.com', name: 'Staff' })
  expect(result.ok).toBe(false)
  expect(inserts.find(row => row.table === 'lead_activity')?.values).toMatchObject({ event_type: 'sms_failed' })
})
