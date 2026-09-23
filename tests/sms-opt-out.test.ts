import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A number that texted STOP must never be texted again from the app until it
 * texts START. The old send path never looked, so this guards the check itself
 * (sendOutboundSms) and the bookkeeping that feeds it (recordInboundSms).
 */

const state = vi.hoisted(() => ({
  optOutRow: null as { opted_in_at: string | null } | null,
  optOutError: null as { message: string } | null,
  inserts: [] as Array<{ table: string; values: Record<string, unknown> }>,
  upserts: [] as Array<{ table: string; values: Record<string, unknown> }>,
  updates: [] as Array<{ table: string; values: Record<string, unknown> }>,
  existingSms: null as { id: string; matter_id: string | null } | null,
}))

vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => table === 'sms_opt_outs'
            ? { data: state.optOutRow, error: state.optOutError }
            : { data: state.existingSms, error: null },
        }),
      }),
      insert: (values: Record<string, unknown>) => {
        state.inserts.push({ table, values })
        return {
          select: () => ({
            single: async () => ({
              data: { id: `${table}-1`, matter_id: null, lead_id: null, recipient_name: null, ...values },
              error: null,
            }),
          }),
        }
      },
      upsert: async (values: Record<string, unknown>) => {
        state.upserts.push({ table, values })
        return { error: null }
      },
      update: (values: Record<string, unknown>) => {
        state.updates.push({ table, values })
        const chain = {
          eq: () => chain,
          select: () => ({ single: async () => ({ data: { id: 'sms_messages-1' }, error: null }) }),
          then: (resolve: (value: { error: null }) => void) => resolve({ error: null }),
        }
        return chain
      },
    }),
  }),
}))

const sendProviderSmsMessage = vi.hoisted(() => vi.fn(async () => ({
  ok: true as const, status: 'queued', providerMessageId: 'msg-1', to: '+15555550123',
})))
vi.mock('@/lib/sms/provider', async () => {
  const transport = await vi.importActual<typeof import('@/lib/sms/transport')>('@/lib/sms/transport')
  return { normalizeSmsRecipient: transport.normalizeSmsRecipient, sendProviderSmsMessage }
})
vi.mock('@/lib/communications/providers', () => ({ smsProvider: () => 'telnyx' }))
vi.mock('@/lib/communications/config', () => ({ isSmsConfigured: () => true }))
vi.mock('@/lib/telnyx/config', () => ({ telnyxPhoneNumber: () => '+15555550100' }))
vi.mock('@/lib/firmConfig', () => ({ getFirmConfig: () => ({ firmName: 'Firm' }) }))

import { isPhoneOptedOut, isSmsOptInMessage, optOutPhoneKey } from '@/lib/sms/optOut'
import { sendOutboundSms, type ResolvedSmsTarget } from '@/lib/sms/outbound'
import { recordInboundSms } from '@/lib/sms/inbound'

const target: ResolvedSmsTarget = {
  recipientName: 'Avery Stone',
  recipientRole: 'client',
  phone: '(555) 555-0123',
  matterId: null,
  leadId: 'lead-1',
}
const actor = { id: 'user-1', email: 'staff@example.com', name: 'Staff' }

beforeEach(() => {
  state.optOutRow = null
  state.optOutError = null
  state.inserts.length = 0
  state.upserts.length = 0
  state.updates.length = 0
  state.existingSms = null
  sendProviderSmsMessage.mockClear()
})

describe('opt-out keys', () => {
  it('matches the SQL normalize_us_phone key for every stored form', () => {
    expect(optOutPhoneKey('+15555550123')).toBe('5555550123')
    expect(optOutPhoneKey('15555550123')).toBe('5555550123')
    expect(optOutPhoneKey('(555) 555-0123')).toBe('5555550123')
    expect(optOutPhoneKey('555-0123')).toBeNull()
  })

  it('treats START, UNSTOP and YES as opting back in, and nothing else', () => {
    expect(isSmsOptInMessage(' start ')).toBe(true)
    expect(isSmsOptInMessage('UNSTOP')).toBe(true)
    expect(isSmsOptInMessage('Yes')).toBe(true)
    expect(isSmsOptInMessage('yes please call me')).toBe(false)
  })
})

describe('isPhoneOptedOut', () => {
  it('is true for an opt-out with no later opt-in, false once opted back in', async () => {
    state.optOutRow = { opted_in_at: null }
    await expect(isPhoneOptedOut('+15555550123')).resolves.toBe(true)
    state.optOutRow = { opted_in_at: '2026-09-20T00:00:00Z' }
    await expect(isPhoneOptedOut('+15555550123')).resolves.toBe(false)
    state.optOutRow = null
    await expect(isPhoneOptedOut('+15555550123')).resolves.toBe(false)
  })

  it('throws rather than reporting "not opted out" when the list cannot be read', async () => {
    state.optOutError = { message: 'boom' }
    await expect(isPhoneOptedOut('+15555550123')).rejects.toThrow('boom')
  })
})

describe('sendOutboundSms honours opt-outs', () => {
  it('refuses an opted-out number with 409 before writing or sending anything', async () => {
    state.optOutRow = { opted_in_at: null }
    const result = await sendOutboundSms(target, 'Hello', actor)
    expect(result).toMatchObject({ ok: false, status: 409 })
    expect(sendProviderSmsMessage).not.toHaveBeenCalled()
    expect(state.inserts).toHaveLength(0)
  })

  it('fails closed with 503 when the opt-out list is unreadable', async () => {
    state.optOutError = { message: 'db down' }
    const result = await sendOutboundSms(target, 'Hello', actor)
    expect(result).toMatchObject({ ok: false, status: 503 })
    expect(sendProviderSmsMessage).not.toHaveBeenCalled()
  })

  it('sends to a number that opted back in', async () => {
    state.optOutRow = { opted_in_at: '2026-09-20T00:00:00Z' }
    const result = await sendOutboundSms(target, 'Hello', actor)
    expect(result.ok).toBe(true)
    expect(sendProviderSmsMessage).toHaveBeenCalledWith({ to: '+15555550123', body: 'Hello' })
  })
})

describe('recordInboundSms keeps the opt-out list', () => {
  const inbound = (body: string) => recordInboundSms({
    fromNumber: '+15555550123',
    toNumber: '+15555550100',
    body,
    providerMessageId: `in-${body}`,
    rawPayload: {},
    provider: 'telnyx',
  })

  it('records STOP as an opt-out keyed by the 10-digit number', async () => {
    const result = await inbound('STOP')
    expect(result).toMatchObject({ ok: true, optedOut: true })
    expect(state.upserts).toEqual([
      expect.objectContaining({
        table: 'sms_opt_outs',
        values: expect.objectContaining({ phone: '5555550123', opted_in_at: null }),
      }),
    ])
  })

  it('re-records the opt-out on a webhook retry of the same STOP', async () => {
    state.existingSms = { id: 'sms-9', matter_id: null }
    await inbound('stop')
    expect(state.upserts[0]?.values).toMatchObject({ phone: '5555550123', source_message_id: 'sms-9' })
  })

  it('records START as an opt-in and an ordinary reply as neither', async () => {
    await inbound('START')
    expect(state.updates.find(u => u.table === 'sms_opt_outs')?.values).toHaveProperty('opted_in_at')
    state.updates.length = 0
    await inbound('Thanks, see you Tuesday')
    expect(state.updates.some(u => u.table === 'sms_opt_outs')).toBe(false)
    expect(state.upserts).toHaveLength(0)
  })
})
