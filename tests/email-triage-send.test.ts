import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The triage page's "Send reply". A sent email cannot be taken back, so these
 * pin down when it refuses, that it sends on the original thread exactly what
 * the page showed, and that it can only send once.
 */

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  consumeRateLimit: vi.fn(),
  fetchRow: vi.fn(),
  getMailboxIdentity: vi.fn(),
  getThread: vi.fn(),
  sendViaGmail: vi.fn(),
  deleteGmailDraft: vi.fn(),
  applyAndRecordMailboxSort: vi.fn(),
  loadArchiveNonClientEnabled: vi.fn(),
  logSend: vi.fn(),
  envEmailsHardKilled: vi.fn(),
  getAllSettings: vi.fn(),
  isAllowed: vi.fn(),
  updates: [] as { patch: Record<string, unknown>; filters: unknown[][] }[],
  claimRows: [{ id: 'row-1' }] as { id: string }[] | null,
}))

vi.mock('@/lib/apiAuth', () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock('@/lib/rateLimit', () => ({ consumeRateLimit: mocks.consumeRateLimit }))
vi.mock('@/lib/queries/emailTriage', () => ({ fetchEmailTriageRow: mocks.fetchRow }))
vi.mock('@/lib/email/gmailRead', () => ({
  GmailReadError: class GmailReadError extends Error {},
  getMailboxIdentity: mocks.getMailboxIdentity,
  getThread: mocks.getThread,
}))
vi.mock('@/lib/email/gmailSend', () => ({
  GmailSendError: class GmailSendError extends Error {},
  sendViaGmail: mocks.sendViaGmail,
}))
vi.mock('@/lib/email/gmailDraft', () => ({ deleteGmailDraft: mocks.deleteGmailDraft }))
vi.mock('@/lib/emailTriage/mailboxSort', () => ({
  applyAndRecordMailboxSort: mocks.applyAndRecordMailboxSort,
  loadArchiveNonClientEnabled: mocks.loadArchiveNonClientEnabled,
}))
vi.mock('@/lib/email/send', () => ({ logSend: mocks.logSend }))
vi.mock('@/lib/email/settings', () => ({
  envEmailsHardKilled: mocks.envEmailsHardKilled,
  getAllSettings: mocks.getAllSettings,
  isAllowed: mocks.isAllowed,
}))
vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        const entry = { patch, filters: [] as unknown[][] }
        mocks.updates.push(entry)
        const chain = {
          eq: (...args: unknown[]) => { entry.filters.push(['eq', ...args]); return chain },
          is: (...args: unknown[]) => { entry.filters.push(['is', ...args]); return chain },
          in: (...args: unknown[]) => { entry.filters.push(['in', ...args]); return chain },
          select: async () => ({ data: mocks.claimRows, error: null }),
          then: (resolve: (value: unknown) => void) => resolve({ data: null, error: null }),
        }
        return chain
      },
    }),
  }),
}))

import { POST } from '@/app/api/admin/email-triage/[id]/send/route'

const ATTORNEY = 'scott@aubreylegal.com'

function message(id: string, from: string, extra: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    threadId: 'thread-1',
    from: { name: null, email: from },
    to: [],
    cc: [],
    subject: 'Trust question',
    snippet: '',
    receivedAt: '2026-10-01T12:00:00.000Z',
    messageIdHeader: `<${id}@mail.example>`,
    references: null,
    inReplyTo: null,
    headers: {},
    bodyText: '',
    attachments: [],
    labelIds: ['INBOX'],
    ...extra,
  }
}

function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'row-1',
    gmail_thread_id: 'thread-1',
    gmail_message_id: 'msg-in',
    sender_email: 'client@example.com',
    sender_name: 'Pat Client',
    subject: 'Trust question',
    snippet: '',
    received_at: '2026-10-01T12:00:00.000Z',
    classification: 'client',
    classification_reason: null,
    client_intake_id: null,
    matter_id: 'matter-1',
    contact_id: null,
    status: 'drafted',
    draft_subject: 'Re: Trust question',
    draft_body: 'Stored draft',
    draft_error: null,
    gmail_draft_id: null,
    gmail_draft_message_id: null,
    human_draft_at: null,
    ...overrides,
  }
}

function send(body: Record<string, unknown> = { draftSubject: 'Re: Trust question', draftBody: 'Hi Pat — yes.' }) {
  return POST(
    new Request('https://app.test/api/admin/email-triage/row-1/send', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'row-1' }) },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.updates.length = 0
  mocks.claimRows = [{ id: 'row-1' }]
  mocks.requireAdmin.mockResolvedValue({ userId: 'attorney-1' })
  mocks.consumeRateLimit.mockResolvedValue({ ok: true })
  mocks.fetchRow.mockResolvedValue(baseRow())
  mocks.envEmailsHardKilled.mockReturnValue(false)
  mocks.getAllSettings.mockResolvedValue({ manual: { mode: 'on', provider: 'gmail' } })
  mocks.isAllowed.mockReturnValue(true)
  mocks.getMailboxIdentity.mockResolvedValue({ token: 'tok', address: ATTORNEY })
  mocks.getThread.mockResolvedValue({ id: 'thread-1', messages: [message('msg-in', 'client@example.com')] })
  mocks.sendViaGmail.mockResolvedValue({ fromAddress: ATTORNEY, messageId: 'sent-1', threadId: 'thread-1' })
  mocks.deleteGmailDraft.mockResolvedValue(undefined)
  mocks.loadArchiveNonClientEnabled.mockResolvedValue(true)
  mocks.applyAndRecordMailboxSort.mockResolvedValue({ label: 'Cornerstone/Client', error: null })
  mocks.logSend.mockResolvedValue('log-1')
})

describe('POST /api/admin/email-triage/[id]/send', () => {
  it('sends the on-screen reply from Gmail, threaded onto the message being answered', async () => {
    const res = await send()
    expect(res.status).toBe(200)
    expect(mocks.sendViaGmail).toHaveBeenCalledTimes(1)
    expect(mocks.sendViaGmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'client@example.com',
      subject: 'Re: Trust question',
      // What the page showed, not the stored copy the autosave may not have reached.
      text: 'Hi Pat — yes.',
      threadId: 'thread-1',
      inReplyTo: '<msg-in@mail.example>',
      userId: 'attorney-1',
    }))
  })

  it('logs the send to the matter timeline and closes the row', async () => {
    await send()
    expect(mocks.logSend).toHaveBeenCalledWith(expect.objectContaining({
      matter_id: 'matter-1',
      category: 'manual',
      provider: 'gmail',
      provider_message_id: 'sent-1',
      status: 'sent',
      to_email: 'client@example.com',
    }))
    const last = mocks.updates.at(-1)!
    expect(last.patch).toMatchObject({ status: 'replied', draft_error: null })
  })

  it('removes an earlier Gmail draft so it cannot go out a second time', async () => {
    mocks.fetchRow.mockResolvedValue(baseRow({
      status: 'approved',
      gmail_draft_id: 'draft-1',
      gmail_draft_message_id: 'draft-msg',
    }))
    mocks.getThread.mockResolvedValue({
      id: 'thread-1',
      messages: [
        message('msg-in', 'client@example.com'),
        message('draft-msg', ATTORNEY, { labelIds: ['DRAFT'] }),
      ],
    })
    const res = await send()
    expect(res.status).toBe(200)
    expect(mocks.deleteGmailDraft).toHaveBeenCalledWith('draft-1', 'attorney-1')
    expect(mocks.updates.at(-1)!.patch).toMatchObject({ gmail_draft_id: null })
  })

  it('reports, rather than fails on, a draft it could not remove after sending', async () => {
    mocks.fetchRow.mockResolvedValue(baseRow({ status: 'approved', gmail_draft_id: 'draft-1' }))
    mocks.deleteGmailDraft.mockRejectedValue(new Error('boom'))
    const res = await send()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.notices.join(' ')).toMatch(/could not be removed/)
  })

  it('sends only once: a second request that loses the claim sends nothing', async () => {
    mocks.claimRows = []
    const res = await send()
    expect(res.status).toBe(409)
    expect(mocks.sendViaGmail).not.toHaveBeenCalled()
  })

  it('refuses when the attorney already answered in Gmail, and resolves the row', async () => {
    mocks.getThread.mockResolvedValue({
      id: 'thread-1',
      messages: [
        message('msg-in', 'client@example.com'),
        message('msg-out', ATTORNEY, { receivedAt: '2026-10-01T13:00:00.000Z' }),
      ],
    })
    const res = await send()
    expect(res.status).toBe(409)
    expect(mocks.sendViaGmail).not.toHaveBeenCalled()
    expect(mocks.updates.at(-1)!.patch).toMatchObject({ status: 'replied' })
  })

  it('refuses when the sender has written again since the draft', async () => {
    mocks.getThread.mockResolvedValue({
      id: 'thread-1',
      messages: [
        message('msg-in', 'client@example.com'),
        message('msg-newer', 'client@example.com', { receivedAt: '2026-10-01T14:00:00.000Z' }),
      ],
    })
    const res = await send()
    expect(res.status).toBe(409)
    expect(mocks.sendViaGmail).not.toHaveBeenCalled()
    // The claim is released so a send after review is still possible.
    expect(mocks.updates.at(-1)!.patch).toEqual({ replied_at: null })
  })

  it.each([
    ['the deployment kill switch', () => mocks.envEmailsHardKilled.mockReturnValue(true)],
    ['manual email switched off', () => mocks.getAllSettings.mockResolvedValue({ manual: { mode: 'off', provider: 'gmail' } })],
    ['test-inbox redirect', () => mocks.getAllSettings.mockResolvedValue({ manual: { mode: 'redirect', provider: 'gmail' } })],
    ['the allowlist', () => mocks.isAllowed.mockReturnValue(false)],
  ])('honours %s by refusing', async (_name, arrange) => {
    arrange()
    const res = await send()
    expect(res.status).toBe(409)
    expect(mocks.sendViaGmail).not.toHaveBeenCalled()
  })

  it('refuses an empty reply', async () => {
    const res = await send({ draftSubject: 'Re: x', draftBody: '   ' })
    expect(res.status).toBe(400)
    expect(mocks.sendViaGmail).not.toHaveBeenCalled()
  })

  it.each(['replied', 'dismissed', 'drafting'])('refuses a %s row', async status => {
    mocks.fetchRow.mockResolvedValue(baseRow({ status }))
    const res = await send()
    expect(res.status).toBe(409)
    expect(mocks.sendViaGmail).not.toHaveBeenCalled()
  })

  it('releases the claim and records the error when Gmail refuses the send', async () => {
    mocks.sendViaGmail.mockRejectedValue(new Error('403: insufficient permissions'))
    const res = await send()
    expect(res.status).toBe(502)
    expect(mocks.logSend).not.toHaveBeenCalled()
    expect(mocks.updates.some(u => u.patch.replied_at === null)).toBe(true)
    expect(mocks.updates.at(-1)!.patch.draft_error).toMatch(/^Not sent:/)
  })
})
