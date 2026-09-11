import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/googleCalendar', () => ({
  getAccessToken: vi.fn(),
  getGoogleConnectionForUser: vi.fn(),
  hasGmailModifyScope: vi.fn(),
}))

import {
  charsetToEncoding,
  decodeBase64Url,
  extractBody,
  headersToMap,
  htmlToText,
  parseAddress,
  parseAddressList,
  parseMessage,
  parseThread,
  stripQuotedChain,
} from '@/lib/email/gmailRead'

/**
 * Gmail's wire format is the one input to triage the firm does not control, and
 * every rule downstream reads the shapes this module produces. A parsing bug
 * here does not throw — it quietly yields an empty body, a sender that matches
 * no client, or a message dated 1970, all of which look like "nothing needs a
 * reply". These pin the cases that would fail that way.
 */

function b64url(value: string, encoding: BufferEncoding = 'utf-8'): string {
  return Buffer.from(value, encoding).toString('base64url')
}

const header = (name: string, value: string) => ({ name, value })

describe('decodeBase64Url', () => {
  it('decodes the base64url alphabet Gmail uses, without padding', () => {
    // '~~~?' encodes to bytes that produce both '-' and '_' in base64url.
    const raw = Buffer.from('subject?>=', 'utf-8').toString('base64url')
    expect(raw).not.toContain('=')
    expect(decodeBase64Url(raw)).toBe('subject?>=')
  })

  it('returns empty for a part Gmail sent with no data', () => {
    expect(decodeBase64Url(undefined)).toBe('')
    expect(decodeBase64Url(null)).toBe('')
    expect(decodeBase64Url('')).toBe('')
  })

  it('honours a non-UTF-8 charset rather than mangling the text', () => {
    const latin = b64url('Bonne journée', 'latin1')
    expect(decodeBase64Url(latin, 'utf-8')).not.toBe('Bonne journée')
    expect(decodeBase64Url(latin, 'latin1')).toBe('Bonne journée')
  })
})

describe('charsetToEncoding', () => {
  it('maps the charsets that actually arrive', () => {
    expect(charsetToEncoding('text/plain; charset="UTF-8"')).toBe('utf-8')
    expect(charsetToEncoding('text/plain; charset=ISO-8859-1')).toBe('latin1')
    expect(charsetToEncoding('text/html; charset=windows-1252')).toBe('latin1')
    expect(charsetToEncoding('text/plain; charset=us-ascii')).toBe('ascii')
  })

  it('defaults to UTF-8 when the part declares nothing', () => {
    expect(charsetToEncoding(undefined)).toBe('utf-8')
    expect(charsetToEncoding('text/plain')).toBe('utf-8')
  })
})

describe('headersToMap', () => {
  it('lowercases names so callers never guess Gmail’s casing', () => {
    const map = headersToMap([header('Message-ID', '<a@b>'), header('LIST-Unsubscribe', '<x>')])
    expect(map['message-id']).toBe('<a@b>')
    expect(map['list-unsubscribe']).toBe('<x>')
  })

  it('keeps the first of a repeated header', () => {
    const map = headersToMap([header('Received', 'first'), header('Received', 'second')])
    expect(map.received).toBe('first')
  })
})

describe('parseAddress', () => {
  it('splits a display name from the address and lowercases the address', () => {
    expect(parseAddress('Jane Doe <Jane@Example.com>')).toEqual({
      name: 'Jane Doe',
      email: 'jane@example.com',
    })
  })

  it('unwraps a quoted display name', () => {
    expect(parseAddress('"Doe, Jane" <jane@example.com>')).toEqual({
      name: 'Doe, Jane',
      email: 'jane@example.com',
    })
  })

  it('accepts a bare address', () => {
    expect(parseAddress('jane@example.com')).toEqual({ name: null, email: 'jane@example.com' })
  })

  it('returns null for an absent header rather than a sender that matches nothing', () => {
    expect(parseAddress(undefined)).toBeNull()
    expect(parseAddress('   ')).toBeNull()
  })
})

describe('parseAddressList', () => {
  it('does not split on a comma inside a quoted display name', () => {
    const list = parseAddressList('"Doe, Jane" <jane@example.com>, Bob <bob@example.com>')
    expect(list).toHaveLength(2)
    expect(list[0].email).toBe('jane@example.com')
    expect(list[1].email).toBe('bob@example.com')
  })
})

describe('htmlToText', () => {
  it('drops script and style content instead of reading it as prose', () => {
    const text = htmlToText('<p>Hello</p><script>alert(1)</script><style>p{color:red}</style>')
    expect(text).toBe('Hello')
  })

  it('turns block boundaries into newlines and decodes entities', () => {
    expect(htmlToText('<p>One</p><p>Two&nbsp;&amp;&nbsp;three</p>')).toBe('One\nTwo & three')
  })
})

describe('extractBody', () => {
  it('prefers the plain part of a multipart/alternative', () => {
    const body = extractBody({
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/plain', body: { data: b64url('plain version') } },
        { mimeType: 'text/html', body: { data: b64url('<p>html version</p>') } },
      ],
    })
    expect(body).toBe('plain version')
  })

  it('falls back to HTML when that is all the sender sent', () => {
    const body = extractBody({
      mimeType: 'text/html',
      body: { data: b64url('<p>Only html</p>') },
    })
    expect(body).toBe('Only html')
  })

  it('recurses through multipart/mixed to reach the body', () => {
    const body = extractBody({
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [{ mimeType: 'text/plain', body: { data: b64url('nested body') } }],
        },
        { mimeType: 'application/pdf', filename: 'will.pdf', body: { attachmentId: 'a1' } },
      ],
    })
    expect(body).toBe('nested body')
  })

  it('skips attachments, including a text part sent as a file', () => {
    const body = extractBody({
      mimeType: 'multipart/mixed',
      parts: [
        { mimeType: 'text/plain', body: { data: b64url('the real body') } },
        { mimeType: 'text/plain', filename: 'notes.txt', body: { data: b64url('attached notes') } },
        { mimeType: 'text/plain', body: { attachmentId: 'a2' } },
      ],
    })
    expect(body).toBe('the real body')
    expect(body).not.toContain('attached notes')
  })

  it('decodes a part using its own declared charset', () => {
    const body = extractBody({
      mimeType: 'text/plain',
      headers: [header('Content-Type', 'text/plain; charset=ISO-8859-1')],
      body: { data: b64url('Café du Nord', 'latin1') },
    })
    expect(body).toBe('Café du Nord')
  })

  it('truncates a body too long to be worth drafting against', () => {
    const body = extractBody({
      mimeType: 'text/plain',
      body: { data: b64url('x'.repeat(25_000)) },
    })
    expect(body.length).toBeLessThan(25_000)
    expect(body.endsWith('[truncated]')).toBe(true)
  })

  it('returns empty rather than throwing when there is no text part at all', () => {
    expect(extractBody({ mimeType: 'application/pdf', filename: 'x.pdf' })).toBe('')
    expect(extractBody(undefined)).toBe('')
  })
})

describe('stripQuotedChain', () => {
  it('cuts a Gmail "On … wrote:" chain', () => {
    const body = [
      'Thanks for sending the draft, I have a few questions about the trustee.',
      '',
      'On Tue, 3 Sep 2026 at 10:04, Scott <scott@aubreylegal.com> wrote:',
      '> Here is the draft for your review.',
    ].join('\n')
    expect(stripQuotedChain(body)).toBe(
      'Thanks for sending the draft, I have a few questions about the trustee.',
    )
  })

  it('cuts a Gmail chain whose "On …," wrapped onto the next line', () => {
    const body = [
      'That works for me, Tuesday is fine and I will bring the deed.',
      '',
      'On Tue, 3 Sep 2026 at 10:04 Scott Aubrey,',
      '<scott@aubreylegal.com> wrote:',
      '> Does Tuesday work?',
    ].join('\n')
    expect(stripQuotedChain(body)).toBe(
      'That works for me, Tuesday is fine and I will bring the deed.',
    )
  })

  it('cuts an Outlook original-message divider', () => {
    const body = [
      'Confirming receipt of the documents you sent over yesterday.',
      '-----Original Message-----',
      'From: Scott',
    ].join('\n')
    expect(stripQuotedChain(body)).toBe(
      'Confirming receipt of the documents you sent over yesterday.',
    )
  })

  it('cuts an Outlook underscore divider', () => {
    const body = [
      'I have attached the deed as requested, let me know if anything is missing.',
      '________________________________',
      'From: Scott Aubrey',
    ].join('\n')
    expect(stripQuotedChain(body)).toBe(
      'I have attached the deed as requested, let me know if anything is missing.',
    )
  })

  it('cuts an Outlook quoted header block', () => {
    const body = [
      'Please see my answers to your questions below, and let me know.',
      'From: Scott Aubrey <scott@aubreylegal.com>',
      'Sent: Tuesday, September 3, 2026 10:04 AM',
      'To: Jane Doe',
      'Subject: Your estate plan',
    ].join('\n')
    expect(stripQuotedChain(body)).toBe(
      'Please see my answers to your questions below, and let me know.',
    )
  })

  it('does not cut on a "From:" that is just a sentence the client wrote', () => {
    // Enough prose above the line that the short-result guard cannot rescue
    // this — the `From:` rule itself has to decline to fire.
    const body = [
      'I read through the draft last night and mostly it looks right to me.',
      'From: the trustee’s perspective, the distribution schedule seems wrong.',
      'Could we talk it through before the signing on the 14th?',
    ].join('\n')
    expect(stripQuotedChain(body)).toBe(body)
  })

  it('cuts a run of quoted lines', () => {
    const body = [
      'Yes, please go ahead and file it with the registry this week.',
      '> previous line one',
      '> previous line two',
    ].join('\n')
    expect(stripQuotedChain(body)).toBe(
      'Yes, please go ahead and file it with the registry this week.',
    )
  })

  it('leaves a single line that merely starts with ">" alone', () => {
    const body = '> 50% of the estate is what we discussed, can you confirm that split?'
    expect(stripQuotedChain(body)).toBe(body)
  })

  it('keeps the whole message when stripping would leave almost nothing', () => {
    // A real reply. Cutting at the marker leaves "Yes." — too little for the
    // model to answer, so the quoted chain is the lesser evil.
    const body = [
      'Yes.',
      '',
      'On Tue, 3 Sep 2026 at 10:04, Scott <scott@aubreylegal.com> wrote:',
      '> Shall I file the homestead declaration?',
    ].join('\n')
    expect(stripQuotedChain(body)).toContain('Shall I file the homestead declaration?')
  })
})

describe('parseMessage', () => {
  const raw = {
    id: 'm1',
    threadId: 't1',
    labelIds: ['INBOX', 'UNREAD'],
    snippet: 'A question about the trust',
    internalDate: '1788000000000',
    payload: {
      mimeType: 'text/plain',
      headers: [
        header('From', 'Jane Doe <jane@example.com>'),
        header('To', 'scott@aubreylegal.com'),
        header('Subject', 'Question about the trust'),
        header('Message-ID', '<abc@mail.example.com>'),
        header('References', '<r1@x> <r2@x>'),
        header('In-Reply-To', '<r2@x>'),
        header('List-Unsubscribe', '<https://unsub.example.com>'),
      ],
      body: { data: b64url('Could you explain the successor trustee clause?') },
    },
  }

  it('maps the headers triage depends on', () => {
    const parsed = parseMessage(raw)!
    expect(parsed.from).toEqual({ name: 'Jane Doe', email: 'jane@example.com' })
    expect(parsed.subject).toBe('Question about the trust')
    expect(parsed.messageIdHeader).toBe('<abc@mail.example.com>')
    expect(parsed.references).toBe('<r1@x> <r2@x>')
    expect(parsed.inReplyTo).toBe('<r2@x>')
    expect(parsed.headers['list-unsubscribe']).toBe('<https://unsub.example.com>')
    expect(parsed.labelIds).toContain('INBOX')
    expect(parsed.bodyText).toBe('Could you explain the successor trustee clause?')
  })

  it('converts internalDate milliseconds to an ISO timestamp', () => {
    expect(parseMessage(raw)!.receivedAt).toBe(new Date(1788000000000).toISOString())
  })

  it('rejects a message with no parseable sender instead of inventing one', () => {
    expect(parseMessage({ ...raw, payload: { ...raw.payload, headers: [] } })).toBeNull()
    expect(parseMessage({ threadId: 't1' })).toBeNull()
  })
})

describe('parseThread', () => {
  const message = (id: string, internalDate: string, from: string) => ({
    id,
    threadId: 't1',
    internalDate,
    labelIds: [],
    payload: { mimeType: 'text/plain', headers: [header('From', from)], body: { data: b64url('hi') } },
  })

  it('orders messages oldest first, whatever order Gmail returned them in', () => {
    const thread = parseThread({
      id: 't1',
      messages: [
        message('m2', '2000', 'b@example.com'),
        message('m1', '1000', 'a@example.com'),
        message('m3', '3000', 'c@example.com'),
      ],
    })!
    expect(thread.messages.map(m => m.id)).toEqual(['m1', 'm2', 'm3'])
  })

  it('drops a thread with nothing parseable rather than returning an empty one', () => {
    expect(parseThread({ id: 't1', messages: [] })).toBeNull()
    expect(parseThread({ messages: [message('m1', '1000', 'a@example.com')] })).toBeNull()
  })
})
