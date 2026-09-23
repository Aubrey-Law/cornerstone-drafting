import { beforeEach, describe, expect, it, vi } from 'vitest'

const inserts: Array<{ table: string; values: Record<string, unknown> }> = []

/** Per-table rows the fake client hands back, reset per test. */
const rows: Record<string, Record<string, unknown> | null> = {}

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
          select: () => ({ single: async () => ({ data: { id: 'sms_messages-1' }, error: null }) }),
        }),
      }),
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: rows[table] ?? null, error: null }) }),
      }),
    }),
  }),
}))

vi.mock('@/lib/sms/provider', () => ({
  normalizeSmsRecipient: (phone: string | null) => phone,
  sendProviderSmsMessage: vi.fn(async () => ({
    ok: true,
    status: 'queued',
    providerMessageId: 'SM456',
  })),
}))

vi.mock('@/lib/communications/providers', () => ({ smsProvider: () => 'telnyx' }))
vi.mock('@/lib/communications/config', () => ({ isSmsConfigured: () => true }))
vi.mock('@/lib/sms/optOut', () => ({ isPhoneOptedOut: vi.fn(async () => false) }))
vi.mock('@/lib/telnyx/config', () => ({ telnyxPhoneNumber: () => '+15555550100' }))

import { resolveContactSmsTarget, sendOutboundSms } from '@/lib/sms/outbound'

const ACTOR = { id: 'user-1', email: 'staff@example.com', name: 'Staff' }

beforeEach(() => {
  inserts.length = 0
  for (const key of Object.keys(rows)) delete rows[key]
})

describe('resolveContactSmsTarget', () => {
  it('resolves a standalone contact with no household', async () => {
    rows.contacts = {
      id: 'c-1',
      first_name: 'Rita',
      last_name: 'Referrer',
      phone: '+16175550104',
      relationship_type: 'other',
      client_intake_id: null,
      deceased: false,
    }

    const { target, error } = await resolveContactSmsTarget('c-1')
    expect(error).toBeNull()
    expect(target).toMatchObject({
      contactId: 'c-1',
      recipientName: 'Rita Referrer',
      recipientRole: 'other',
      phone: '+16175550104',
      matterId: null,
      leadId: null,
    })
  })

  it('inherits the matter of a hired household', async () => {
    rows.contacts = {
      id: 'c-2', first_name: 'Tina', last_name: 'Trust', phone: '+16175550103',
      relationship_type: 'trustee', client_intake_id: 'i-1', deceased: false,
    }
    rows.client_intake = { id: 'i-1', matter_id: 'm-1' }
    rows.matters = { id: 'm-1', relationship_status: 'hired' }

    const { target } = await resolveContactSmsTarget('c-2')
    // contactId owns the thread; matterId rides along so the matter tab sees it.
    expect(target).toMatchObject({ contactId: 'c-2', matterId: 'm-1', leadId: null })
  })

  it('inherits the lead when the household has not been hired', async () => {
    rows.contacts = {
      id: 'c-3', first_name: 'Sam', last_name: 'Spouse', phone: '+16175550105',
      relationship_type: 'spouse', client_intake_id: 'i-2', deceased: false,
    }
    rows.client_intake = { id: 'i-2', matter_id: 'm-2' }
    rows.matters = { id: 'm-2', relationship_status: 'lead' }

    const { target } = await resolveContactSmsTarget('c-3')
    expect(target).toMatchObject({ contactId: 'c-3', matterId: null, leadId: 'i-2' })
    expect(target?.recipientRole).toBe('spouse')
  })

  it('treats a null relationship_status as a client, like the rest of the app', async () => {
    rows.contacts = {
      id: 'c-4', first_name: 'Old', last_name: 'Contact', phone: '+16175550106',
      relationship_type: 'child', client_intake_id: 'i-3', deceased: false,
    }
    rows.client_intake = { id: 'i-3', matter_id: 'm-3' }
    rows.matters = { id: 'm-3', relationship_status: null }

    const { target } = await resolveContactSmsTarget('c-4')
    expect(target).toMatchObject({ matterId: 'm-3', leadId: null })
  })

  it('refuses a deceased contact', async () => {
    rows.contacts = {
      id: 'c-5', first_name: 'Gone', last_name: 'Away', phone: '+16175550107',
      relationship_type: 'other', client_intake_id: null, deceased: true,
    }
    const { target, error } = await resolveContactSmsTarget('c-5')
    expect(target).toBeNull()
    expect(error).toMatch(/deceased/i)
  })

  it('reports a missing contact', async () => {
    const { target, error } = await resolveContactSmsTarget('nope')
    expect(target).toBeNull()
    expect(error).toBe('Contact not found')
  })
})

describe('sendOutboundSms for a contact', () => {
  it('stamps contact_id on the message row', async () => {
    const result = await sendOutboundSms(
      { recipientName: 'Rita Referrer', recipientRole: 'other', phone: '+16175550104', matterId: null, leadId: null, contactId: 'c-1' },
      'Thanks for the referral.',
      ACTOR,
    )
    expect(result.ok).toBe(true)
    const sms = inserts.find(i => i.table === 'sms_messages')
    expect(sms?.values).toMatchObject({ contact_id: 'c-1', matter_id: null, lead_id: null, recipient_role: 'other' })
  })

  it('writes no activity row when there is no matter or lead to write to', async () => {
    // There is no contact_activity table — the sms_messages row is the record.
    await sendOutboundSms(
      { recipientName: 'Rita Referrer', recipientRole: 'other', phone: '+16175550104', matterId: null, leadId: null, contactId: 'c-1' },
      'Thanks for the referral.',
      ACTOR,
    )
    expect(inserts.map(i => i.table)).toEqual(['sms_messages'])
  })

  it('still logs matter activity when a contact inherits a matter', async () => {
    await sendOutboundSms(
      { recipientName: 'Tina Trust', recipientRole: 'other', phone: '+16175550103', matterId: 'm-1', leadId: null, contactId: 'c-2' },
      'Sending the trustee certificate.',
      ACTOR,
    )
    expect(inserts.map(i => i.table)).toEqual(['sms_messages', 'matter_activity'])
    expect(inserts.find(i => i.table === 'sms_messages')?.values)
      .toMatchObject({ contact_id: 'c-2', matter_id: 'm-1' })
  })
})
