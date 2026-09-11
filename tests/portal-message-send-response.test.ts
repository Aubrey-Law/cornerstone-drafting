import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(), status: vi.fn(), insert: vi.fn(), saved: vi.fn(), email: vi.fn(),
  after: vi.fn(), callbacks: [] as Array<() => Promise<void>>,
}))
vi.mock('next/server', () => ({ after: mocks.after }))
vi.mock('@/lib/supabaseServer', () => ({ createServerSupabase: async () => ({
  auth: { getUser: mocks.getUser },
  from: (table: string) => {
    if (table === 'matters') return { select: () => ({ eq: () => ({ maybeSingle: mocks.status }) }) }
    if (table === 'messages') return { insert: mocks.insert }
    throw new Error(`Unexpected table: ${table}`)
  },
}) }))
vi.mock('@/lib/supabaseAdmin', () => ({ ADMIN_EMAIL: 'attorney@example.invalid', getAdminClient: vi.fn() }))
vi.mock('@/lib/email/send', () => ({ sendEmail: mocks.email }))
import { sendMessage } from '@/app/(portal)/messages/actions'

const message = { id: 'saved-message', matter_id: 'matter', body: 'Synthetic message', sender_id: 'client', sender_role: 'client', created_at: '2026-09-11T12:00:00Z', read_at: null }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.callbacks = []
  mocks.after.mockImplementation((callback: () => Promise<void>) => mocks.callbacks.push(callback))
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'client', email: 'client@example.invalid', user_metadata: {} } } })
  mocks.status.mockResolvedValue({ data: { status: 'active', relationship_status: 'hired' }, error: null })
  mocks.insert.mockReturnValue({ select: () => ({ single: mocks.saved }) })
  mocks.saved.mockResolvedValue({ data: message, error: null })
  mocks.email.mockResolvedValue({ ok: true, status: 'sent' })
})
afterEach(() => vi.restoreAllMocks())

describe('portal send response', () => {
  it('returns the persisted message before notification delivery starts', async () => {
    let finishEmail!: () => void
    mocks.email.mockReturnValue(new Promise<void>(resolve => { finishEmail = resolve }))
    let returned = false
    const send = sendMessage('matter', '  Synthetic message  ').then(result => { returned = true; return result })
    try {
      // Flush the finite auth/status/insert chain while delivery remains unresolved.
      for (let i = 0; i < 20; i++) await Promise.resolve()
      expect(returned).toBe(true)
      expect(mocks.email).not.toHaveBeenCalled()
      expect(await send).toEqual(message)
      expect(mocks.insert).toHaveBeenCalledExactlyOnceWith({ matter_id: 'matter', sender_role: 'client', sender_id: 'client', body: 'Synthetic message' })
      expect(mocks.callbacks).toHaveLength(1)
      const notification = mocks.callbacks[0]()
      expect(mocks.email).toHaveBeenCalledWith(expect.objectContaining({ category: 'message_alert', to: 'attorney@example.invalid', replyTo: 'client@example.invalid' }))
      finishEmail()
      await notification
    } finally {
      finishEmail()
      await send
    }
  })

  it('keeps the saved message successful if notification delivery fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.email.mockRejectedValue(new Error('Provider unavailable'))
    await expect(sendMessage('matter', message.body)).resolves.toEqual(message)
    expect(mocks.callbacks).toHaveLength(1)
    await expect(mocks.callbacks[0]()).resolves.toBeUndefined()
    expect(mocks.insert).toHaveBeenCalledTimes(1)
  })

  it('does not turn a scheduler failure into a failed send after persistence', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.after.mockImplementation(() => { throw new Error('No request lifetime available') })
    await expect(sendMessage('matter', message.body)).resolves.toEqual(message)
    expect(mocks.email).not.toHaveBeenCalled()
  })

  it('rejects a failed database write without scheduling an alert', async () => {
    mocks.saved.mockResolvedValue({ data: null, error: { message: 'Write failed' } })
    await expect(sendMessage('matter', message.body)).rejects.toThrow('Write failed')
    expect(mocks.after).not.toHaveBeenCalled()
    expect(mocks.email).not.toHaveBeenCalled()
  })

  it.each(['unauthenticated', 'closed', 'not hired'] as const)('does not insert or notify for %s requests', async kind => {
    if (kind === 'unauthenticated') mocks.getUser.mockResolvedValue({ data: { user: null } })
    else mocks.status.mockResolvedValue({ data: { status: kind === 'closed' ? 'closed' : 'active', relationship_status: kind === 'not hired' ? 'lead' : 'hired' } })
    await expect(sendMessage('matter', message.body)).rejects.toThrow()
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.after).not.toHaveBeenCalled()
  })
})
