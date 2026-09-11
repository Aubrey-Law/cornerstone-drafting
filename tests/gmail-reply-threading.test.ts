import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/googleCalendar', () => ({
  getAccessToken: vi.fn(),
  getGoogleConnectionForUser: vi.fn(),
  hasGmailSendScope: vi.fn(),
  hasGmailModifyScope: vi.fn(),
}))

import { buildMimeMessage } from '@/lib/email/gmailSend'
import { buildReplyHeaders } from '@/lib/email/replyHeaders'

/**
 * Threading is the part of this feature that fails invisibly. Gmail attaches a
 * draft on its own `threadId`, so a reply with wrong or missing `In-Reply-To`
 * and `References` looks perfectly threaded on the firm's side and arrives in
 * the client's inbox as a brand new conversation.
 */

const BASE = { to: 'client@example.com', subject: 'Re: Your estate plan', text: 'Hello' }

describe('buildReplyHeaders', () => {
  it('points In-Reply-To at the message being answered', () => {
    const headers = buildReplyHeaders({ messageId: '<abc@mail.example.com>' })
    expect(headers.inReplyTo).toBe('<abc@mail.example.com>')
  })

  it('appends the parent to the chain it inherited', () => {
    const headers = buildReplyHeaders({
      messageId: '<c@x>',
      references: '<a@x> <b@x>',
    })
    expect(headers.references).toEqual(['<a@x>', '<b@x>', '<c@x>'])
  })

  it('falls back to the parent’s In-Reply-To when it carried no References', () => {
    // RFC 5322 §3.6.4: the second message in a thread has an In-Reply-To and
    // no References, and dropping it would orphan the chain at depth three.
    const headers = buildReplyHeaders({ messageId: '<b@x>', inReplyTo: '<a@x>' })
    expect(headers.references).toEqual(['<a@x>', '<b@x>'])
  })

  it('starts a chain from a thread’s first message', () => {
    expect(buildReplyHeaders({ messageId: '<a@x>' }).references).toEqual(['<a@x>'])
  })

  it('does not repeat an id already in the chain', () => {
    const headers = buildReplyHeaders({ messageId: '<b@x>', references: '<a@x> <b@x>' })
    expect(headers.references).toEqual(['<a@x>', '<b@x>'])
  })

  it('keeps the thread root and the most recent ids when the chain is long', () => {
    const long = Array.from({ length: 40 }, (_, i) => `<m${i}@x>`).join(' ')
    const headers = buildReplyHeaders({ messageId: '<final@x>', references: long })

    expect(headers.references).toHaveLength(20)
    // The root is what clients group on, so it survives the trim.
    expect(headers.references?.[0]).toBe('<m0@x>')
    expect(headers.references?.at(-1)).toBe('<final@x>')
  })

  it('emits nothing at all when the parent has no usable Message-ID', () => {
    // Gmail's threadId still threads it on the firm's side. A malformed header
    // would break the client's, which is worse than none.
    expect(buildReplyHeaders({ messageId: null })).toEqual({})
    expect(buildReplyHeaders({ messageId: 'not-a-message-id' })).toEqual({})
  })

  it('reads ids out of a header with odd whitespace', () => {
    const headers = buildReplyHeaders({ messageId: '  <c@x>  ', references: '<a@x>\r\n <b@x>' })
    expect(headers.inReplyTo).toBe('<c@x>')
    expect(headers.references).toEqual(['<a@x>', '<b@x>', '<c@x>'])
  })
})

describe('buildMimeMessage threading headers', () => {
  it('writes the reply headers literally, not RFC 2047 encoded', () => {
    // The reason these do not go through encodeHeaderValue: a base64 "encoded
    // word" here is a header that looks fine and matches nothing.
    const raw = buildMimeMessage({
      ...BASE,
      inReplyTo: '<abc@mail.example.com>',
      references: ['<a@x>', '<abc@mail.example.com>'],
    })
    expect(raw).toContain('In-Reply-To: <abc@mail.example.com>')
    expect(raw).toContain('References: <a@x> <abc@mail.example.com>')
    expect(raw).not.toContain('=?UTF-8?B?')
  })

  it('strips a CRLF injection attempt out of a Message-ID', () => {
    // These values come from headers written by whoever sent the message, which
    // makes them the one header-injection vector in this module.
    const raw = buildMimeMessage({
      ...BASE,
      inReplyTo: '<a@x>\r\nBcc: attacker@evil.com',
    })
    expect(raw).not.toContain('attacker@evil.com')
    expect(raw).not.toMatch(/^Bcc:/m)
  })

  it('drops a token that is not a well-formed message id', () => {
    const raw = buildMimeMessage({ ...BASE, inReplyTo: 'abc@mail.example.com' })
    expect(raw).not.toContain('In-Reply-To:')
  })

  it('drops non-ASCII rather than encoding it, and keeps the rest of the chain', () => {
    const raw = buildMimeMessage({ ...BASE, references: ['<a@x>', '<béad>', '<c@x>'] })
    expect(raw).toContain('References: <a@x> <bad> <c@x>')
  })

  it('leaves existing callers byte-identical', () => {
    // Every current caller starts a new conversation and passes neither field.
    // This is the regression that matters: the send path is live.
    const args = {
      to: 'client@example.com',
      subject: 'Your estate plan',
      from: 'firm@aubreylegal.com',
      cc: ['cpa@example.com'],
      replyTo: 'scott@aubreylegal.com',
      text: 'Hello',
      html: '<p>Hello</p>',
    }
    const before = buildMimeMessage(args).replace(/(alt|mixed)-[a-z0-9-]+/g, '$1-BOUNDARY')
    const after = buildMimeMessage({ ...args, inReplyTo: undefined, references: undefined })
      .replace(/(alt|mixed)-[a-z0-9-]+/g, '$1-BOUNDARY')

    expect(after).toBe(before)
    expect(before).not.toContain('In-Reply-To')
    expect(before).not.toContain('References')
  })
})
