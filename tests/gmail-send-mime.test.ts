import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/googleCalendar', () => ({
  getAccessToken: vi.fn(),
  getGoogleConnectionForUser: vi.fn(),
  hasGmailSendScope: vi.fn(),
}))

import { buildMimeMessage } from '@/lib/email/gmailSend'

/**
 * Gmail takes a whole RFC 5322 message, so the message is this module's output
 * rather than a request body a vendor SDK validates. These pin the parts a
 * malformed message would break silently: the recipient headers, the
 * alternative ordering, and the boundaries.
 */
const BASE = { to: 'client@example.com', subject: 'Your estate plan' }

function decodePart(raw: string, contentType: string): string {
  const boundary = /boundary="(alt-[^"]+)"/.exec(raw)?.[1]
  if (!boundary) throw new Error('no multipart/alternative boundary')
  const section = raw
    .split(`--${boundary}`)
    .find(part => part.includes(`Content-Type: ${contentType}`))
  if (!section) throw new Error(`no ${contentType} part`)
  const body = section.split('\r\n\r\n').slice(1).join('\r\n\r\n')
  return Buffer.from(body.replace(/[\r\n]/g, ''), 'base64').toString('utf-8')
}

describe('buildMimeMessage', () => {
  it('carries every recipient header, with bcc so Gmail delivers to it', () => {
    const raw = buildMimeMessage({
      ...BASE,
      from: 'firm@aubreylegal.com',
      cc: ['cpa@example.com'],
      bcc: ['file@example.com'],
      replyTo: 'scott@aubreylegal.com',
      text: 'Hello',
    })
    expect(raw).toContain('To: client@example.com')
    expect(raw).toContain('From: firm@aubreylegal.com')
    expect(raw).toContain('Cc: cpa@example.com')
    expect(raw).toContain('Bcc: file@example.com')
    expect(raw).toContain('Reply-To: scott@aubreylegal.com')
  })

  it('base64-encodes a plain-text body rather than sending it raw', () => {
    const raw = buildMimeMessage({ ...BASE, text: 'Hello — signed, Scott' })
    expect(raw).toContain('Content-Type: text/plain; charset="UTF-8"')
    const body = raw.split('\r\n\r\n').slice(1).join('')
    expect(Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf-8'))
      .toBe('Hello — signed, Scott')
  })

  it('sends html alone as text/html, not wrapped in a needless multipart', () => {
    const raw = buildMimeMessage({ ...BASE, html: '<p>Hello</p>' })
    expect(raw).toContain('Content-Type: text/html; charset="UTF-8"')
    expect(raw).not.toContain('multipart/')
  })

  it('puts the plain part before the html one, which is what picks the winner', () => {
    // multipart/alternative is "last one the client understands wins", so the
    // order is the whole meaning: html last, or every client shows plain text.
    const raw = buildMimeMessage({ ...BASE, text: 'Hello', html: '<p>Hello</p>' })
    expect(raw).toContain('Content-Type: multipart/alternative')
    expect(raw.indexOf('text/plain')).toBeLessThan(raw.indexOf('text/html'))
    expect(decodePart(raw, 'text/plain')).toBe('Hello')
    expect(decodePart(raw, 'text/html')).toBe('<p>Hello</p>')
  })

  it('wraps body and files in multipart/mixed, and closes every boundary', () => {
    const raw = buildMimeMessage({
      ...BASE,
      html: '<p>Signed copies attached.</p>',
      text: 'Signed copies attached.',
      attachments: [
        { filename: 'will.pdf', content: Buffer.from('PDF'), contentType: 'application/pdf' },
      ],
    })
    const mixed = /boundary="(mixed-[^"]+)"/.exec(raw)?.[1]
    const alt = /boundary="(alt-[^"]+)"/.exec(raw)?.[1]
    expect(mixed).toBeTruthy()
    expect(alt).toBeTruthy()
    expect(raw).toContain(`--${mixed}--`)
    expect(raw).toContain(`--${alt}--`)
    expect(raw).toContain('Content-Disposition: attachment; filename="will.pdf"')
    expect(raw).toContain('Content-Type: application/pdf; name="will.pdf"')
  })

  it('encodes a non-ASCII subject rather than putting raw bytes in a header', () => {
    const raw = buildMimeMessage({ ...BASE, subject: 'Plan für Müller', text: 'x' })
    expect(raw).toContain(`Subject: =?UTF-8?B?${Buffer.from('Plan für Müller').toString('base64')}?=`)
  })

  it('strips newlines from header values, so a subject cannot inject a header', () => {
    const raw = buildMimeMessage({
      ...BASE,
      subject: 'Hello\r\nBcc: attacker@example.com',
      text: 'x',
    })
    expect(raw).toContain('Subject: Hello Bcc: attacker@example.com')
    expect(raw).not.toMatch(/^Bcc: attacker@example\.com$/m)
  })

  it('wraps base64 at 76 characters, which MIME requires of a long body', () => {
    const raw = buildMimeMessage({ ...BASE, text: 'x'.repeat(500) })
    const body = raw.split('\r\n\r\n').slice(1).join('\r\n\r\n')
    expect(body.split('\r\n').every(line => line.length <= 76)).toBe(true)
  })
})
