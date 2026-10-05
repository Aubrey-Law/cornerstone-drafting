import fs from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The delegation dial on invoice reminders. A reminder is money talk with a
 * client, so these pin down when the dial stays out of it (Propose, final
 * notices, no actor) and that an acting position goes through the shared
 * registry action rather than around it.
 */

const mocks = vi.hoisted(() => ({
  resolveActionAutonomy: vi.fn(),
  createActionProposal: vi.fn(),
}))

vi.mock('@/lib/actions/delegation', () => ({ resolveActionAutonomy: mocks.resolveActionAutonomy }))
vi.mock('@/lib/actions/server', () => ({ createActionProposal: mocks.createActionProposal }))

import { delegateInvoiceReminder, reminderSummary } from '@/lib/billing/delegateReminders'
import { getActionDefinition } from '@/lib/actions/registry'

const row = {
  id: '00000000-0000-0000-0000-000000000030',
  invoice_id: '00000000-0000-0000-0000-000000000031',
  escalation_level: 'friendly' as const,
  recipient_email: 'client@example.com',
  invoice_number: '2026-0042',
  matter_id: '00000000-0000-0000-0000-000000000020',
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveActionAutonomy.mockResolvedValue('act_report')
  mocks.createActionProposal.mockResolvedValue({ autonomy: 'act_report', duplicate: false, execution: { status: 'succeeded' } })
})

describe('delegating an invoice reminder', () => {
  it('leaves the draft waiting at Propose', async () => {
    mocks.resolveActionAutonomy.mockResolvedValue('propose')
    expect(await delegateInvoiceReminder({ row, actorId: 'attorney-1' })).toBe('skipped')
    expect(mocks.createActionProposal).not.toHaveBeenCalled()
  })

  it('never sends a final notice unattended, whatever the dial says', async () => {
    expect(await delegateInvoiceReminder({ row: { ...row, escalation_level: 'final' }, actorId: 'attorney-1' })).toBe('skipped')
    expect(mocks.resolveActionAutonomy).not.toHaveBeenCalled()
  })

  it('does nothing without a staff user to send as', async () => {
    expect(await delegateInvoiceReminder({ row, actorId: null })).toBe('skipped')
    expect(mocks.createActionProposal).not.toHaveBeenCalled()
  })

  it('sends through the registry action with the dial applied, one decision per draft', async () => {
    expect(await delegateInvoiceReminder({ row, actorId: 'attorney-1' })).toBe('sent')
    expect(mocks.createActionProposal).toHaveBeenCalledWith(expect.objectContaining({
      actionKey: 'billing.reminder.send',
      referencePayload: { reminderId: row.id },
      recordType: 'matter',
      recordId: row.matter_id,
      source: 'automation',
      applyAutonomy: true,
      idempotencyKey: `invoice-reminder:${row.id}`,
      displaySummary: 'Send the friendly reminder for invoice 2026-0042 to client@example.com',
    }), { id: 'attorney-1' })
  })

  it('records an observed proposal at Observe', async () => {
    mocks.resolveActionAutonomy.mockResolvedValue('observe')
    mocks.createActionProposal.mockResolvedValue({ autonomy: 'observe', duplicate: false, execution: null })
    expect(await delegateInvoiceReminder({ row, actorId: 'attorney-1' })).toBe('observed')
  })

  it('reports a refused send as failed and leaves the draft to a person', async () => {
    mocks.createActionProposal.mockRejectedValue(new Error('The client email changed; regenerate this reminder before sending'))
    expect(await delegateInvoiceReminder({ row, actorId: 'attorney-1' })).toBe('failed')
  })

  it('names the invoice and recipient in plain words', () => {
    expect(reminderSummary({ escalation_level: 'firm', recipient_email: 'a@b.c', invoice_number: null }))
      .toBe('Send the firm reminder for an invoice to a@b.c')
  })
})

describe('the reminder send registry action', () => {
  it('is an external write with no undo', () => {
    const definition = getActionDefinition('billing.reminder.send')
    expect(definition?.risk).toBe('external_write')
    expect(definition?.undo).toBeUndefined()
    expect(() => definition?.validate({ reminderId: 'nope' }, { id: 'u' })).toThrow('reminder identifier')
  })

  it('keeps the message in the confirmation preview, not the audit projection', () => {
    const source = fs.readFileSync('lib/actions/registry.ts', 'utf8')
    const action = source.slice(source.indexOf("key: 'billing.reminder.send'"), source.indexOf("key: 'task.delegate'"))
    expect(action).toContain('content: reminder.body')
    expect(action).not.toContain('auditAfter: { content')
    expect(action).toContain("channel: 'email'")
  })
})

describe('where drafting, the cron and the approve route meet the dial', () => {
  it('offers only freshly inserted drafts to the dial, after drafting is complete', () => {
    const prepare = fs.readFileSync('lib/billing/prepareInvoiceReminders.ts', 'utf8')
    expect(prepare).toContain(".select('id').maybeSingle()")
    expect(prepare.indexOf('drafted += 1')).toBeLessThan(prepare.indexOf('await delegateInvoiceReminder({'))
    expect(prepare).toContain('if (options.actorId) {')
  })

  it('runs cron sends as the firm attorney and still prepares when none can be resolved', () => {
    const cron = fs.readFileSync('app/api/cron/invoice-reminders/route.ts', 'utf8')
    expect(cron).toContain('resolveUnattendedActor().then(actor => actor?.id ?? null, () => null)')
    expect(cron).toContain('prepareInvoiceReminderDrafts({ actorId })')
  })

  it('sends from one module whether the attorney approved or the dial acted', () => {
    const approve = fs.readFileSync('app/api/admin/billing/reminders/[id]/approve/route.ts', 'utf8')
    expect(approve).toContain("from '@/lib/billing/sendInvoiceReminder'")
    expect(approve).not.toContain('emailInvoice')
    const send = fs.readFileSync('lib/billing/sendInvoiceReminder.ts', 'utf8')
    // The claim comes before any render or send, and a failed send returns the draft.
    expect(send.indexOf("rpc('approve_invoice_reminder'")).toBeLessThan(send.indexOf('renderAndAttachInvoice('))
    expect(send).toContain("update({ status: 'draft', approved_by: null, approved_at: null })")
  })
})
