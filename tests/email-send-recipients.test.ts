import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Behavioural cover for how cc/bcc reach the providers — in particular that a
 * test-mode redirect strips blind recipients, so a redirected send can never
 * quietly deliver to a real inbox.
 */

const resendSend = vi.hoisted(() => vi.fn())
const sendViaGmail = vi.hoisted(() => vi.fn())
const getAllSettings = vi.hoisted(() => vi.fn())
const isAllowed = vi.hoisted(() => vi.fn())
const insert = vi.hoisted(() => vi.fn())

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: resendSend }
  },
}))
vi.mock('@/lib/email/gmailSend', () => ({
  sendViaGmail,
  GmailSendError: class extends Error {},
}))
vi.mock('@/lib/email/settings', () => ({
  envEmailsHardKilled: () => false,
  getAllSettings,
  getTestInbox: () => 'test-inbox@example.com',
  isAllowed,
}))
vi.mock('@/lib/firmSettings', () => ({
  getResendFromAsync: async () => 'firm@example.com',
  loadFirmSettings: async () => ({}),
}))
vi.mock('@/lib/email/brandWrapper', () => ({
  isFullEmailDocument: () => true,
  wrapEmailWithBrand: (html: string) => html,
}))
vi.mock('@/lib/email/templates', () => ({
  applyEmailTemplate: vi.fn(),
  getDefaultEmailTemplate: async () => null,
}))
vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        insert(row)
        return { select: () => ({ single: async () => ({ data: { id: 'log-1' }, error: null }) }) }
      },
    }),
  }),
}))

const BASE = {
  category: 'manual' as const,
  to: 'client@example.com',
  subject: 'Hello',
  html: '<p>Hi</p>',
  text: 'Hi',
  useStoredTemplate: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.RESEND_API_KEY = 'test-key'
  getAllSettings.mockResolvedValue({ manual: { mode: 'live', provider: 'resend' } })
  isAllowed.mockReturnValue(true)
  resendSend.mockResolvedValue({ data: { id: 'r1' }, error: null })
})

describe('sendEmail recipients', () => {
  it('passes cc and bcc through to Resend on a live send', async () => {
    const { sendEmail } = await import('@/lib/email/send')
    await sendEmail({ ...BASE, cc: ['cpa@example.com'], bcc: ['file@example.com'] })

    expect(resendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        cc: ['cpa@example.com'],
        bcc: ['file@example.com'],
      }),
    )
  })

  it('strips cc and bcc when the send is redirected to the test inbox', async () => {
    getAllSettings.mockResolvedValue({ manual: { mode: 'redirect', provider: 'resend' } })
    const { sendEmail } = await import('@/lib/email/send')
    const result = await sendEmail({ ...BASE, cc: ['cpa@example.com'], bcc: ['file@example.com'] })

    expect(result).toMatchObject({ ok: true, status: 'redirected' })
    const payload = resendSend.mock.calls[0][0]
    expect(payload.to).toBe('test-inbox@example.com')
    expect(payload.cc).toBeUndefined()
    expect(payload.bcc).toBeUndefined()
  })

  it('passes bcc to Gmail when that is the configured provider', async () => {
    getAllSettings.mockResolvedValue({ manual: { mode: 'live', provider: 'gmail' } })
    sendViaGmail.mockResolvedValue({ fromAddress: 'firm@example.com', messageId: 'g1' })
    const { sendEmail } = await import('@/lib/email/send')
    await sendEmail({ ...BASE, bcc: ['file@example.com'] })

    expect(sendViaGmail).toHaveBeenCalledWith(
      expect.objectContaining({ bcc: ['file@example.com'] }),
    )
    expect(resendSend).not.toHaveBeenCalled()
  })

  it('records bcc on the email log row', async () => {
    const { sendEmail } = await import('@/lib/email/send')
    await sendEmail({ ...BASE, bcc: ['file@example.com', 'archive@example.com'] })

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ bcc: 'file@example.com, archive@example.com' }),
    )
  })

  it('accepts a comma-separated bcc string as well as an array', async () => {
    const { sendEmail } = await import('@/lib/email/send')
    await sendEmail({ ...BASE, bcc: 'one@example.com, two@example.com' })

    expect(resendSend).toHaveBeenCalledWith(
      expect.objectContaining({ bcc: ['one@example.com', 'two@example.com'] }),
    )
  })
})
