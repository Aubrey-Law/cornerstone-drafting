import fs from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The delegation dial on triage replies. A sent email cannot be taken back,
 * so these pin down when the dial stays out of it (Propose, strangers, no
 * actor), what it records at Observe, and that an acting position goes
 * through the shared registry action rather than around it.
 */

const mocks = vi.hoisted(() => ({
  resolveActionAutonomy: vi.fn(),
  createActionProposal: vi.fn(),
  updates: [] as Array<Record<string, unknown>>,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/actions/delegation', () => ({ resolveActionAutonomy: mocks.resolveActionAutonomy }))
vi.mock('@/lib/actions/server', () => ({ createActionProposal: mocks.createActionProposal }))
vi.mock('@/lib/supabaseAdmin', () => ({
  getAdminClient: () => ({
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        mocks.updates.push(patch)
        const chain = { eq: () => chain, is: () => chain, then: (resolve: (value: unknown) => void) => resolve({ data: null, error: null }) }
        return chain
      },
    }),
  }),
}))

import { delegateTriageReply, triageReplySummary } from '@/lib/emailTriage/delegate'
import { getActionDefinition } from '@/lib/actions/registry'

const row = {
  id: '00000000-0000-0000-0000-000000000010',
  gmail_message_id: 'msg-in',
  classification: 'client' as const,
  sender_email: 'client@example.com',
  sender_name: 'Pat Client',
  subject: 'Trust question',
  matter_id: '00000000-0000-0000-0000-000000000020',
  client_intake_id: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.updates.length = 0
  mocks.resolveActionAutonomy.mockResolvedValue('act_report')
  mocks.createActionProposal.mockResolvedValue({ autonomy: 'act_report', duplicate: false, execution: { status: 'succeeded' } })
})

describe('delegating a triage reply', () => {
  it('leaves the triage page as the proposal surface at Propose', async () => {
    mocks.resolveActionAutonomy.mockResolvedValue('propose')
    expect(await delegateTriageReply({ row, actorId: 'attorney-1' })).toBe('skipped')
    expect(mocks.createActionProposal).not.toHaveBeenCalled()
  })

  it('never answers a stranger or a contact unattended, whatever the dial says', async () => {
    for (const classification of ['contact', 'possible_lead'] as const) {
      expect(await delegateTriageReply({ row: { ...row, classification }, actorId: 'attorney-1' })).toBe('skipped')
    }
    expect(mocks.resolveActionAutonomy).not.toHaveBeenCalled()
    expect(mocks.createActionProposal).not.toHaveBeenCalled()
  })

  it('does nothing without a staff user to send as', async () => {
    expect(await delegateTriageReply({ row, actorId: null })).toBe('skipped')
    expect(mocks.createActionProposal).not.toHaveBeenCalled()
  })

  it('sends through the registry action with the dial applied, keyed to the inbound message', async () => {
    expect(await delegateTriageReply({ row, actorId: 'attorney-1' })).toBe('sent')
    expect(mocks.createActionProposal).toHaveBeenCalledWith(expect.objectContaining({
      actionKey: 'email.triage.reply.send',
      referencePayload: { triageId: row.id },
      recordType: 'matter',
      recordId: row.matter_id,
      source: 'automation',
      applyAutonomy: true,
      idempotencyKey: `triage-reply:${row.id}:msg-in`,
      displaySummary: 'Reply to Pat Client re: Trust question',
    }), { id: 'attorney-1' })
  })

  it('records an observed proposal at Observe and reports it as such', async () => {
    mocks.resolveActionAutonomy.mockResolvedValue('observe')
    mocks.createActionProposal.mockResolvedValue({ autonomy: 'observe', duplicate: false, execution: null })
    expect(await delegateTriageReply({ row, actorId: 'attorney-1' })).toBe('observed')
  })

  it('leaves the draft on the page with the reason when the send is refused', async () => {
    mocks.createActionProposal.mockRejectedValue(new Error('This thread was already answered in Gmail, so nothing was sent'))
    expect(await delegateTriageReply({ row, actorId: 'attorney-1' })).toBe('failed')
    expect(mocks.updates.at(-1)?.draft_error).toBe('Not sent: This thread was already answered in Gmail, so nothing was sent')
  })

  it('names the sender and subject in plain words', () => {
    expect(triageReplySummary({ sender_email: 'a@b.c', sender_name: null, subject: null })).toBe('Reply to a@b.c')
    expect(triageReplySummary({ sender_email: 'a@b.c', sender_name: ' Pat ', subject: 'Hi' })).toBe('Reply to Pat re: Hi')
  })
})

describe('the triage reply registry action', () => {
  it('is an external write with no undo', () => {
    const definition = getActionDefinition('email.triage.reply.send')
    expect(definition?.risk).toBe('external_write')
    expect(definition?.undo).toBeUndefined()
    expect(() => definition?.validate({ triageId: 'not-a-uuid' }, { id: 'u' })).toThrow('triage thread')
  })

  it('keeps the exact reply text in the confirmation preview, not the audit projection', () => {
    const source = fs.readFileSync('lib/actions/registry.ts', 'utf8')
    const action = source.slice(source.indexOf("key: 'email.triage.reply.send'"), source.indexOf("key: 'task.delegate'"))
    expect(action).toContain('content: row.draft_body')
    expect(action).toContain("auditAfter: {\n          triageId: row.id,\n          channel: 'email'")
    expect(action).not.toContain('auditAfter: { content')
  })
})

describe('where the scan and the page meet the shared send', () => {
  it('consults the dial only after a draft is stored, and sends as the mailbox owner on a cron run', () => {
    const scan = fs.readFileSync('lib/emailTriage/scan.ts', 'utf8')
    const stored = scan.indexOf("status: 'drafted',")
    const delegated = scan.indexOf('await delegateTriageReply({')
    expect(stored).toBeGreaterThan(0)
    expect(delegated).toBeGreaterThan(stored)
    expect(scan).toContain('actorId: opts.actorId ?? identity.userId ?? null')
  })

  it('sends from one module whether the attorney clicked or the dial acted', () => {
    const route = fs.readFileSync('app/api/admin/email-triage/[id]/send/route.ts', 'utf8')
    expect(route).toContain("from '@/lib/emailTriage/sendReply'")
    expect(route).not.toContain('sendViaGmail')
    const registry = fs.readFileSync('lib/actions/registry.ts', 'utf8')
    expect(registry).toContain("await import('@/lib/emailTriage/sendReply')")
  })
})
