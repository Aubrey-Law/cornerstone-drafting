import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireAdmin = vi.hoisted(() => vi.fn())
const sendEmail = vi.hoisted(() => vi.fn())
const loadMatterDocumentAttachments = vi.hoisted(() => vi.fn())
const consumeRateLimit = vi.hoisted(() => vi.fn())
const insert = vi.hoisted(() => vi.fn())

vi.mock('@/lib/apiAuth', () => ({ requireAdmin }))
vi.mock('@/lib/email/send', () => ({ sendEmail }))
vi.mock('@/lib/rateLimit', () => ({ consumeRateLimit }))
vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({ from: () => ({ insert }) }),
}))
vi.mock('@/lib/email/attachments', async () => {
  const actual = await vi.importActual<typeof import('@/lib/email/attachments')>(
    '@/lib/email/attachments',
  )
  return { ...actual, loadMatterDocumentAttachments }
})

function formRequest(payload: Record<string, unknown>, files: File[] = []) {
  const form = new FormData()
  form.set('payload', JSON.stringify(payload))
  for (const file of files) form.append('files', file)
  return new Request('http://test/api/admin/email/send', { method: 'POST', body: form })
}

const BASE = {
  to: 'client@example.com',
  subject: 'Draft ready',
  html: '<p>The draft is attached.</p>',
  text: 'The draft is attached.',
}

beforeEach(() => {
  vi.clearAllMocks()
  requireAdmin.mockResolvedValue({ err: null, userId: 'u1', user: { email: 'scott@example.com' } })
  consumeRateLimit.mockResolvedValue({ ok: true })
  sendEmail.mockResolvedValue({ ok: true, status: 'sent', resendId: 'r1', logId: 'l1' })
  loadMatterDocumentAttachments.mockResolvedValue([])
  insert.mockResolvedValue({ error: null })
})

describe('POST /api/admin/email/send', () => {
  it('sends a one-off email and logs nothing when no record is in context', async () => {
    const { POST } = await import('@/app/api/admin/email/send/route')
    const response = await POST(formRequest(BASE))

    expect(response.status).toBe(200)
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'manual', to: 'client@example.com', useStoredTemplate: false }),
    )
    expect(insert).not.toHaveBeenCalled()
  })

  it('carries computer uploads through as attachments', async () => {
    const { POST } = await import('@/app/api/admin/email/send/route')
    const file = new File(['hello world'], 'notes.txt', { type: 'text/plain' })
    await POST(formRequest(BASE, [file]))

    const attachments = sendEmail.mock.calls[0][0].attachments
    expect(attachments).toHaveLength(1)
    expect(attachments[0].filename).toBe('notes.txt')
    expect(attachments[0].content.toString()).toBe('hello world')
  })

  it('reads matter documents server-side and logs the matter activity', async () => {
    loadMatterDocumentAttachments.mockResolvedValue([
      { filename: 'Trust.docx', content: Buffer.from('doc'), contentType: 'application/msword' },
    ])
    const { POST } = await import('@/app/api/admin/email/send/route')
    await POST(formRequest({ ...BASE, matterId: 'm1', documentIds: ['d1'] }))

    expect(loadMatterDocumentAttachments).toHaveBeenCalledWith(expect.anything(), 'm1', ['d1'])
    expect(sendEmail.mock.calls[0][0].attachments).toHaveLength(1)
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        matter_id: 'm1',
        event_type: 'email_sent',
        detail: expect.stringContaining('1 attachment'),
      }),
    )
  })

  it('logs to the lead timeline when scoped to a lead', async () => {
    const { POST } = await import('@/app/api/admin/email/send/route')
    await POST(formRequest({ ...BASE, leadId: 'l1' }))

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ lead_id: 'l1', event_type: 'email_sent' }),
    )
  })

  it('never fetches documents for a matter the request did not name', async () => {
    const { POST } = await import('@/app/api/admin/email/send/route')
    await POST(formRequest({ ...BASE, documentIds: ['d1'] }))

    expect(loadMatterDocumentAttachments).not.toHaveBeenCalled()
    expect(sendEmail.mock.calls[0][0].attachments).toBeUndefined()
  })

  it('rejects attachments over the size cap before sending', async () => {
    const { POST } = await import('@/app/api/admin/email/send/route')
    const huge = new File([new Uint8Array(11 * 1024 * 1024)], 'huge.zip')
    const response = await POST(formRequest(BASE, [huge]))

    expect(response.status).toBe(413)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('validates the recipient, subject and body', async () => {
    const { POST } = await import('@/app/api/admin/email/send/route')

    expect((await POST(formRequest({ ...BASE, to: 'not-an-address' }))).status).toBe(400)
    expect((await POST(formRequest({ ...BASE, subject: '' }))).status).toBe(400)
    expect((await POST(formRequest({ ...BASE, html: '', text: '' }))).status).toBe(400)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('surfaces a provider failure as a 502', async () => {
    sendEmail.mockResolvedValue({ ok: false, status: 'error', error: 'Mailbox full', logId: null })
    const { POST } = await import('@/app/api/admin/email/send/route')
    const response = await POST(formRequest(BASE))

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'Mailbox full' })
    expect(insert).not.toHaveBeenCalled()
  })

  it('forwards a valid cc list and drops anything malformed', async () => {
    const { POST } = await import('@/app/api/admin/email/send/route')
    await POST(formRequest({ ...BASE, cc: ['cpa@example.com', 'nope', 'para@example.com'] }))

    expect(sendEmail.mock.calls[0][0].cc).toEqual(['cpa@example.com', 'para@example.com'])
  })

  it('omits cc entirely when none survives validation', async () => {
    const { POST } = await import('@/app/api/admin/email/send/route')
    await POST(formRequest({ ...BASE, cc: ['nope'] }))

    expect(sendEmail.mock.calls[0][0].cc).toBeUndefined()
  })

  it('forwards bcc separately from cc', async () => {
    const { POST } = await import('@/app/api/admin/email/send/route')
    await POST(formRequest({ ...BASE, cc: ['cpa@example.com'], bcc: ['file@example.com', 'bad'] }))

    expect(sendEmail.mock.calls[0][0].cc).toEqual(['cpa@example.com'])
    expect(sendEmail.mock.calls[0][0].bcc).toEqual(['file@example.com'])
  })
})
