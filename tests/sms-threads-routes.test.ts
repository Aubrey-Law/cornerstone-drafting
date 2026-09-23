import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SmsThread } from '@/lib/queries/smsThreads'

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  smsConfigured: { value: true },
  getSmsThreadSummary: vi.fn(),
  getSmsThreadMessages: vi.fn(),
  listSmsThreads: vi.fn(),
  linkSmsThread: vi.fn(),
  markSmsThreadRead: vi.fn(),
  softDeleteSmsMessage: vi.fn(),
  softDeleteSmsThread: vi.fn(),
  sendOutboundSms: vi.fn(),
  createLead: vi.fn(),
  revalidateSidebarCounts: vi.fn(),
}))

vi.mock('@/lib/apiAuth', () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock('@/lib/communications/config', () => ({ isSmsConfigured: () => mocks.smsConfigured.value }))
vi.mock('@/lib/sms/outbound', () => ({ sendOutboundSms: mocks.sendOutboundSms }))
vi.mock('@/lib/leads/createLead', () => ({ createLead: mocks.createLead }))
vi.mock('@/lib/sidebarCountsInvalidation', () => ({ revalidateSidebarCounts: mocks.revalidateSidebarCounts }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: () => ({}) }))
vi.mock('@/lib/queries/smsThreads', () => ({
  getSmsThreadSummary: mocks.getSmsThreadSummary,
  getSmsThreadMessages: mocks.getSmsThreadMessages,
  listSmsThreads: mocks.listSmsThreads,
  linkSmsThread: mocks.linkSmsThread,
  markSmsThreadRead: mocks.markSmsThreadRead,
  softDeleteSmsMessage: mocks.softDeleteSmsMessage,
  softDeleteSmsThread: mocks.softDeleteSmsThread,
}))

import { GET as listRoute } from '@/app/api/admin/texts/threads/route'
import { GET as threadRoute, DELETE as deleteThreadRoute } from '@/app/api/admin/texts/threads/[phone]/route'
import { DELETE as deleteMessageRoute } from '@/app/api/admin/texts/messages/[id]/route'
import { POST as readRoute } from '@/app/api/admin/texts/threads/[phone]/read/route'
import { POST as sendRoute } from '@/app/api/admin/texts/threads/[phone]/send/route'
import { POST as linkRoute } from '@/app/api/admin/texts/threads/[phone]/link/route'
import { POST as createLeadRoute } from '@/app/api/admin/texts/threads/[phone]/create-lead/route'
import { NextRequest } from 'next/server'

const LEAD_ID = '11111111-1111-4111-8111-111111111111'
const params = (phone: string) => ({ params: Promise.resolve({ phone }) })
const post = (body: unknown) => new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify(body) })

function thread(overrides: Partial<SmsThread> = {}): SmsThread {
  return {
    phone: '5555550123', phoneE164: '+15555550123', name: 'Avery Stone', kind: 'lead',
    href: `/admin/leads/${LEAD_ID}`, leadId: LEAD_ID, matterId: 'matter-1', contactId: null,
    lastBody: 'Hi', lastDirection: 'inbound', lastStatus: 'received',
    lastMessageAt: '2026-09-20T00:00:00Z', unreadCount: 1, optedOut: false,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.smsConfigured.value = true
  mocks.requireAdmin.mockResolvedValue({
    err: null, userId: 'user-1', user: { email: 'staff@example.com', user_metadata: { full_name: 'Staff' } },
  })
  mocks.sendOutboundSms.mockResolvedValue({ ok: true, status: 'queued', smsMessage: { id: 'sms-1' } })
})

describe('Texts API authorization', () => {
  it('rejects unauthorized callers on every route', async () => {
    mocks.requireAdmin.mockResolvedValue({ err: new Response(null, { status: 401 }) })
    const responses = await Promise.all([
      listRoute(new NextRequest('http://localhost/x')),
      threadRoute(new NextRequest('http://localhost/x'), params('5555550123')),
      readRoute(post({}), params('5555550123')),
      sendRoute(post({ body: 'Hi' }), params('5555550123')),
      linkRoute(post({ leadId: LEAD_ID }), params('5555550123')),
      createLeadRoute(post({ clientName: 'A', clientEmail: 'a@example.com' }), params('5555550123')),
    ])
    expect(responses.map(r => r.status)).toEqual([401, 401, 401, 401, 401, 401])
    expect(mocks.sendOutboundSms).not.toHaveBeenCalled()
  })
})

describe('GET threads', () => {
  it('passes a known filter through and ignores an unknown one', async () => {
    mocks.listSmsThreads.mockResolvedValue([])
    await listRoute(new NextRequest('http://localhost/x?filter=unknown'))
    expect(mocks.listSmsThreads).toHaveBeenLastCalledWith({ filter: 'unknown', cursor: null })
    await listRoute(new NextRequest('http://localhost/x?filter=drop-table'))
    expect(mocks.listSmsThreads).toHaveBeenLastCalledWith({ filter: 'all', cursor: null })
  })
})

describe('POST send', () => {
  it('is refused while texting is off', async () => {
    mocks.smsConfigured.value = false
    const response = await sendRoute(post({ body: 'Hi' }), params('5555550123'))
    expect(response.status).toBe(503)
    expect(mocks.sendOutboundSms).not.toHaveBeenCalled()
  })

  it('rejects a phone that is not a 10-digit US number', async () => {
    expect((await sendRoute(post({ body: 'Hi' }), params('12345'))).status).toBe(400)
  })

  it('replies to an unknown number with no record link', async () => {
    mocks.getSmsThreadSummary.mockResolvedValue(thread({
      name: null, kind: 'unknown', href: null, leadId: null, matterId: null,
    }))
    const response = await sendRoute(post({ body: 'Who is this?' }), params('+1 (555) 555-0123'))
    expect(response.status).toBe(200)
    expect(mocks.sendOutboundSms).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: '+15555550123', leadId: null, matterId: null, contactId: null, recipientRole: 'other',
        recipientName: '(555) 555-0123',
      }),
      'Who is this?',
      expect.objectContaining({ id: 'user-1' }),
    )
  })

  it('texts the conversation number, not whatever phone the lead now has, and holds leads to 300 characters', async () => {
    mocks.getSmsThreadSummary.mockResolvedValue(thread())
    expect((await sendRoute(post({ body: 'a'.repeat(301) }), params('5555550123'))).status).toBe(400)
    const ok = await sendRoute(post({ body: 'a'.repeat(300) }), params('5555550123'))
    expect(ok.status).toBe(200)
    expect(mocks.sendOutboundSms).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '+15555550123', leadId: LEAD_ID, matterId: 'matter-1' }),
      'a'.repeat(300),
      expect.anything(),
    )
  })

  it('logs a client conversation to the matter, not the old lead', async () => {
    mocks.getSmsThreadSummary.mockResolvedValue(thread({ kind: 'client' }))
    await sendRoute(post({ body: 'a'.repeat(900) }), params('5555550123'))
    expect(mocks.sendOutboundSms).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: null, matterId: 'matter-1', recipientRole: 'client' }),
      expect.any(String),
      expect.anything(),
    )
  })

  it('uses the picked record only for a brand-new conversation', async () => {
    mocks.getSmsThreadSummary.mockResolvedValue(null)
    await sendRoute(post({ body: 'Hi', link: { contactId: 'contact-1', name: 'Pat Trustee' } }), params('5555550123'))
    expect(mocks.sendOutboundSms).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: 'contact-1', recipientName: 'Pat Trustee', recipientRole: 'other' }),
      'Hi',
      expect.anything(),
    )
  })

  it('passes the opt-out refusal through', async () => {
    mocks.getSmsThreadSummary.mockResolvedValue(thread({ optedOut: true }))
    mocks.sendOutboundSms.mockResolvedValue({ ok: false, status: 409, error: 'This number has opted out of texts.' })
    const response = await sendRoute(post({ body: 'Hi' }), params('5555550123'))
    expect(response.status).toBe(409)
  })
})

describe('POST link and create-lead', () => {
  it('requires a real record id to link', async () => {
    expect((await linkRoute(post({ leadId: 'not-a-uuid' }), params('5555550123'))).status).toBe(400)
    expect(mocks.linkSmsThread).not.toHaveBeenCalled()
  })

  it('links the conversation and refreshes the badge', async () => {
    mocks.getSmsThreadSummary.mockResolvedValue(thread())
    const response = await linkRoute(post({ leadId: LEAD_ID }), params('5555550123'))
    expect(response.status).toBe(200)
    expect(mocks.linkSmsThread).toHaveBeenCalledWith('5555550123', { leadId: LEAD_ID, matterId: null, contactId: null })
    expect(mocks.revalidateSidebarCounts).toHaveBeenCalled()
  })

  it('creates a lead with the conversation phone, then links it', async () => {
    mocks.createLead.mockResolvedValue({ leadId: LEAD_ID })
    const response = await createLeadRoute(
      post({ clientName: 'New Person', clientEmail: 'new@example.com' }),
      params('5555550123'),
    )
    expect(response.status).toBe(200)
    expect(mocks.createLead).toHaveBeenCalledWith(expect.objectContaining({
      clientName: 'New Person', clientEmail: 'new@example.com', clientPhone: '+15555550123',
    }))
    expect(mocks.linkSmsThread).toHaveBeenCalledWith('5555550123', { leadId: LEAD_ID })
  })

  it('needs a name and an email to create a lead', async () => {
    expect((await createLeadRoute(post({ clientName: 'No Email' }), params('5555550123'))).status).toBe(400)
    expect(mocks.createLead).not.toHaveBeenCalled()
  })
})

describe('POST read', () => {
  it('refreshes the badge only when something was marked', async () => {
    mocks.markSmsThreadRead.mockResolvedValueOnce(0)
    await readRoute(post({}), params('5555550123'))
    expect(mocks.revalidateSidebarCounts).not.toHaveBeenCalled()
    mocks.markSmsThreadRead.mockResolvedValueOnce(2)
    await readRoute(post({}), params('5555550123'))
    expect(mocks.revalidateSidebarCounts).toHaveBeenCalledTimes(1)
  })
})

describe('DELETE message and conversation', () => {
  const del = () => new NextRequest('http://localhost/x', { method: 'DELETE' })
  const MESSAGE_ID = '22222222-2222-4222-8222-222222222222'

  it('requires authorization', async () => {
    mocks.requireAdmin.mockResolvedValue({ err: new Response(null, { status: 401 }) })
    expect((await deleteMessageRoute(del(), { params: Promise.resolve({ id: MESSAGE_ID }) })).status).toBe(401)
    expect((await deleteThreadRoute(del(), params('5555550123'))).status).toBe(401)
    expect(mocks.softDeleteSmsMessage).not.toHaveBeenCalled()
    expect(mocks.softDeleteSmsThread).not.toHaveBeenCalled()
  })

  it('soft-deletes one message as the signed-in user and refreshes the badge', async () => {
    mocks.softDeleteSmsMessage.mockResolvedValue(true)
    const response = await deleteMessageRoute(del(), { params: Promise.resolve({ id: MESSAGE_ID }) })
    expect(response.status).toBe(200)
    expect(mocks.softDeleteSmsMessage).toHaveBeenCalledWith(MESSAGE_ID, 'user-1')
    expect(mocks.revalidateSidebarCounts).toHaveBeenCalled()
  })

  it('rejects a malformed id and reports a missing or already-deleted message', async () => {
    expect((await deleteMessageRoute(del(), { params: Promise.resolve({ id: 'nope' }) })).status).toBe(400)
    mocks.softDeleteSmsMessage.mockResolvedValue(false)
    expect((await deleteMessageRoute(del(), { params: Promise.resolve({ id: MESSAGE_ID }) })).status).toBe(404)
  })

  it('soft-deletes a whole conversation by its number', async () => {
    mocks.softDeleteSmsThread.mockResolvedValue(3)
    const response = await deleteThreadRoute(del(), params('+1 (555) 555-0123'))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ deleted: 3 })
    expect(mocks.softDeleteSmsThread).toHaveBeenCalledWith('5555550123', 'user-1')
    mocks.softDeleteSmsThread.mockResolvedValue(0)
    expect((await deleteThreadRoute(del(), params('5555550123'))).status).toBe(404)
  })
})
