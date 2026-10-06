import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Inbound mail on the record. The scan files what it can place; the record
 * shows it with a live read and a way to reply; nothing but the snippet is
 * stored. These pin each of those.
 */

import {
  FILED_CLASSIFICATIONS,
  MAX_FILED_PER_THREAD,
  inboundFilingRows,
  inboundMessagesFrom,
  isMissingTableError,
  isOutboundMessage,
  latestInboundMessage,
} from '@/lib/emailTriage/fileInbound'
import { formatLiveThread, gmailThreadHref, inboundEmailItem } from '@/lib/comms/inboundEmail'
import type { GmailMessageSummary, GmailThreadSummary } from '@/lib/email/gmailRead'
import type { SenderMatch } from '@/lib/emailTriage/classifySender'

const FIRM = 'scott@aubreylegal.com'
const FIRM_DOMAINS = ['aubreylegal.com']

function message(over: Partial<GmailMessageSummary> & Pick<GmailMessageSummary, 'id'>): GmailMessageSummary {
  return {
    threadId: 't1', from: { name: 'Pat Smith', email: 'pat@example.com' }, to: [], cc: [], subject: 'Deed question',
    snippet: 'Quick question about the deed', receivedAt: '2026-10-05T12:00:00.000Z', messageIdHeader: `<${over.id}@example.com>`,
    references: null, inReplyTo: null, headers: {}, bodyText: '', labelIds: ['INBOX'], ...over,
  }
}

const thread: GmailThreadSummary = {
  id: 't1',
  messages: [
    message({ id: 'm1', receivedAt: '2026-10-01T12:00:00.000Z', snippet: 'First note' }),
    message({ id: 'm2', from: { name: 'Scott', email: FIRM }, labelIds: ['SENT'], receivedAt: '2026-10-02T12:00:00.000Z' }),
    message({ id: 'm3', from: { name: 'A CPA', email: 'cpa@firm.test' }, receivedAt: '2026-10-03T12:00:00.000Z' }),
    message({ id: 'm4', receivedAt: '2026-10-04T12:00:00.000Z', snippet: 'Following up' }),
    message({ id: 'm5', labelIds: ['DRAFT'], receivedAt: '2026-10-05T12:00:00.000Z' }),
  ],
}

const client: SenderMatch = {
  classification: 'client', clientIntakeId: null, matterId: 'matter-1', contactId: null, displayName: 'Patricia Smith', reason: 'matches a hired matter',
}

describe('choosing what to file', () => {
  it('tells the firm’s own mail from the correspondent’s by label and by address', () => {
    expect(isOutboundMessage(message({ id: 'x', labelIds: ['SENT'] }), FIRM, FIRM_DOMAINS)).toBe(true)
    expect(isOutboundMessage(message({ id: 'x', from: { name: null, email: 'paralegal@aubreylegal.com' } }), FIRM, FIRM_DOMAINS)).toBe(true)
    expect(isOutboundMessage(message({ id: 'x' }), FIRM, FIRM_DOMAINS)).toBe(false)
  })

  it('takes the newest message the firm did not send as the thread’s correspondent, drafts aside', () => {
    expect(latestInboundMessage(thread, FIRM, FIRM_DOMAINS)?.id).toBe('m5')
    const withoutDraft = { ...thread, messages: thread.messages.slice(0, 4) }
    expect(latestInboundMessage(withoutDraft, FIRM, FIRM_DOMAINS)?.id).toBe('m4')
    expect(latestInboundMessage({ id: 't', messages: [thread.messages[1]] }, FIRM, FIRM_DOMAINS)).toBeNull()
  })

  it('files only that sender’s inbound messages, newest first, and never a draft', () => {
    expect(inboundMessagesFrom(thread, 'PAT@example.com', FIRM, FIRM_DOMAINS).map(m => m.id)).toEqual(['m4', 'm1'])
  })

  it('caps a long thread at the newest few', () => {
    const long: GmailThreadSummary = {
      id: 'long',
      messages: Array.from({ length: 25 }, (_, i) => message({ id: `m${i}`, receivedAt: new Date(Date.UTC(2026, 0, 1 + i)).toISOString() })),
    }
    const filed = inboundMessagesFrom(long, 'pat@example.com', FIRM, FIRM_DOMAINS)
    expect(filed).toHaveLength(MAX_FILED_PER_THREAD)
    expect(filed[0].id).toBe('m24')
  })

  it('builds rows carrying the record, the mailbox and the snippet, and nothing of the body', () => {
    const rows = inboundFilingRows({
      thread, sender: thread.messages[3], match: client, connectedAddress: 'Scott@AubreyLegal.com', firmDomains: FIRM_DOMAINS,
      now: new Date('2026-10-05T13:00:00Z'),
    })
    expect(rows.map(row => row.gmail_message_id)).toEqual(['m4', 'm1'])
    expect(rows[0]).toMatchObject({
      connection_email: 'scott@aubreylegal.com', gmail_thread_id: 't1', sender_email: 'pat@example.com', sender_name: 'Patricia Smith',
      subject: 'Deed question', snippet: 'Following up', classification: 'client', matter_id: 'matter-1', client_intake_id: null, contact_id: null,
      received_at: '2026-10-04T12:00:00.000Z', updated_at: '2026-10-05T13:00:00.000Z',
    })
    expect(Object.keys(rows[0])).not.toContain('body_text')
  })

  it('files nothing for a sender the firm cannot place', () => {
    for (const classification of ['possible_lead', 'automated', 'internal'] as const) {
      expect(FILED_CLASSIFICATIONS.has(classification)).toBe(false)
      expect(inboundFilingRows({
        thread, sender: thread.messages[3], match: { ...client, classification }, connectedAddress: FIRM, firmDomains: FIRM_DOMAINS,
      })).toEqual([])
    }
  })

  it('recognises a table that has not been deployed yet', () => {
    expect(isMissingTableError({ code: '42P01', message: 'relation "public.email_inbound_messages" does not exist' })).toBe(true)
    expect(isMissingTableError({ code: 'PGRST205', message: 'Could not find the table' })).toBe(true)
    expect(isMissingTableError({ code: '23505', message: 'duplicate key' })).toBe(false)
    expect(isMissingTableError(null)).toBe(false)
  })
})

describe('the scan files on the way past', () => {
  const source = fs.readFileSync('lib/emailTriage/scan.ts', 'utf8')

  it('files every examined thread with a known sender, not only the ones waiting on a reply', () => {
    const filing = source.indexOf('latestInboundMessage(thread')
    const verdict = source.indexOf('const verdict = evaluateNeedsReply')
    expect(filing).toBeGreaterThan(-1)
    expect(filing).toBeLessThan(verdict)
    expect(source).toContain('FILED_CLASSIFICATIONS.has(classified.classification)')
  })

  it('looks a correspondent up once per run and skips mail already on the record', () => {
    expect(source).toContain('recordMatchBySender')
    expect(source).toContain('loadFiledMessageIds(identity.address)')
    expect(source).toContain("!filedIds!.has(latestInbound.id)")
  })

  it('never lets filing fail the queue: a missing table switches it off for the run', () => {
    expect(source).toContain('let filingAvailable = filedIds !== null')
    expect(source).toContain('if (filed.unavailable) filingAvailable = false')
    expect(source).toContain('messagesFiled')
  })

  it('stays inside the metadata budget so drafting is never starved', () => {
    expect(source).toContain('Date.now() <= metadataDeadline')
  })
})

describe('inbound email on the record', () => {
  const row = {
    id: 'in-1', gmail_thread_id: 'thread-9', sender_email: 'pat@example.com', sender_name: 'Pat Smith',
    subject: 'Deed question', snippet: 'Quick question about the deed', received_at: '2026-10-04T12:00:00.000Z',
  }

  it('reads as an inbound timeline item with a live body and a way to reply', () => {
    const item = inboundEmailItem(row, new Map([['thread-9', 'triage-3']]))
    expect(item).toMatchObject({
      id: 'in-1', channel: 'email', direction: 'inbound', body: 'Quick question about the deed', meta: 'Deed question',
      sender: 'Pat Smith <pat@example.com>', created_at: '2026-10-04T12:00:00.000Z', body_href: '/api/admin/comms/email-inbound/in-1',
    })
    expect(item.links).toEqual([
      { label: 'Reply in Email triage', href: '/admin/email-triage?thread=triage-3' },
      { label: 'Open in Gmail', href: gmailThreadHref('thread-9') },
    ])
  })

  it('offers only Gmail when nothing is open in triage, and copes with a bare row', () => {
    const item = inboundEmailItem({ ...row, sender_name: null, subject: null, snippet: null }, new Map())
    expect(item.links?.map(link => link.label)).toEqual(['Open in Gmail'])
    expect(item).toMatchObject({ body: '(No preview available)', meta: '(No subject)', sender: 'pat@example.com' })
  })

  it('lays the live thread out with the filed message first', () => {
    const text = formatLiveThread([
      { id: 'a', from: { name: 'Pat Smith', email: 'pat@example.com' }, subject: 's', receivedAt: '2026-10-01T12:00:00Z', bodyText: 'First', outbound: false, filed: false },
      { id: 'b', from: { name: null, email: FIRM }, subject: 's', receivedAt: '2026-10-02T12:00:00Z', bodyText: 'Reply', outbound: true, filed: false },
      { id: 'c', from: { name: 'Pat Smith', email: 'pat@example.com' }, subject: 's', receivedAt: '2026-10-04T12:00:00Z', bodyText: 'Following up', outbound: false, filed: true },
    ])
    expect(text.startsWith('Pat Smith · ')).toBe(true)
    expect(text.indexOf('Following up')).toBeLessThan(text.indexOf('— earlier in this thread —'))
    expect(text).toContain('Firm · ')
    expect(formatLiveThread([])).toBe('This message is no longer in Gmail.')
  })

  it('is served by the history route and read live by its own route, staff only', () => {
    const history = fs.readFileSync('app/api/admin/comms/email-history/route.ts', 'utf8')
    expect(history).toContain("from('email_inbound_messages')")
    expect(history).toContain('inboundEmailItem(row, openTriageIdByThread)')
    expect(history).toContain('read_by_staff_at: new Date().toISOString()')
    expect(history).toContain('isMissingTableError(inboundResult.error)')
    const live = fs.readFileSync('app/api/admin/comms/email-inbound/[id]/route.ts', 'utf8')
    expect(live).toContain('requireAdmin(req)')
    expect(live).toContain('getThread({ token: identity.token, threadId: row.gmail_thread_id })')
    expect(live).toContain('filed: message.id === row.gmail_message_id')
    const card = fs.readFileSync('components/comms/RecordCommunicationsCard.tsx', 'utf8')
    expect(card).toContain('loadFullMessage={loadFullMessage}')
    expect(card).not.toContain('Inbound email is not included')
  })

  it('stores snippets only, keyed so a rescan is an update', () => {
    const migration = fs.readFileSync('supabase/migrations/20270111090000_email_inbound_messages.sql', 'utf8')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.email_inbound_messages')
    expect(migration).toContain('ON public.email_inbound_messages (connection_email, gmail_message_id)')
    expect(migration).toMatch(/CHECK \(classification IN \('client', 'lead', 'contact'\)\)/)
    expect(migration).not.toMatch(/body_text|body_html/)
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY')
    const generated = fs.readFileSync('packages/db-types/src/supabase.generated.ts', 'utf8')
    expect(generated).toContain('email_inbound_messages: {')
    expect(generated).toContain('read_by_staff_at: string | null')
  })
})
