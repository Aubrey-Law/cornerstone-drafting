import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { REDACTED, redactEventLinkTokens, redactLinkTokens } from '@/lib/sentry/redact'

const SIGNING_TOKEN = 'Wm9uZV82NF9ieXRlc19vZl9zZWNyZXQ'
const MANAGE_TOKEN = 'bWFuYWdlX2xpbmtfc2VjcmV0X3Rva2Vu'
const INVITE_TOKEN = 'si1.eyJpIjoiYWJjIiwidiI6ImRlZiJ9.c2lnbmF0dXJlX3NlY3JldA'

describe('redactLinkTokens', () => {
  it('redacts the signing token from the page and the API path', () => {
    expect(redactLinkTokens(`https://portal.example.com/sign/${SIGNING_TOKEN}`))
      .toBe(`https://portal.example.com/sign/${REDACTED}`)
    expect(redactLinkTokens(`/api/sign/${SIGNING_TOKEN}`)).toBe(`/api/sign/${REDACTED}`)
  })

  it('redacts the booking manage token from the page and the API path', () => {
    expect(redactLinkTokens(`https://portal.example.com/book/manage/${MANAGE_TOKEN}`))
      .toBe(`https://portal.example.com/book/manage/${REDACTED}`)
    expect(redactLinkTokens(`/api/scheduling/manage/${MANAGE_TOKEN}`))
      .toBe(`/api/scheduling/manage/${REDACTED}`)
  })

  it('redacts the intake invite under either query name it is read from', () => {
    // app/intake/auth/page.tsx accepts `invite` and the older `token`.
    expect(redactLinkTokens(`/intake/auth?invite=${encodeURIComponent(INVITE_TOKEN)}`))
      .toBe(`/intake/auth?invite=${REDACTED}`)
    expect(redactLinkTokens(`/intake/auth?token=${INVITE_TOKEN}&next=/intake`))
      .toBe(`/intake/auth?token=${REDACTED}&next=/intake`)
  })

  it('redacts a token embedded in prose, which is where fetch errors put it', () => {
    expect(redactLinkTokens(`TypeError: Failed to fetch /api/sign/${SIGNING_TOKEN} (net::ERR)`))
      .toBe(`TypeError: Failed to fetch /api/sign/${REDACTED} (net::ERR)`)
  })

  it('leaves Next route patterns alone so Sentry grouping survives', () => {
    // Server transactions are named by the parameterized route. There is no
    // secret in `[token]`, and rewriting it would split one group into two.
    expect(redactLinkTokens('/sign/[token]')).toBe('/sign/[token]')
    expect(redactLinkTokens('/api/scheduling/manage/[token]')).toBe('/api/scheduling/manage/[token]')
  })

  it('leaves unrelated URLs untouched', () => {
    const admin = 'https://portal.example.com/admin/matters/9f1c2b3d?tab=overview'
    expect(redactLinkTokens(admin)).toBe(admin)
    expect(redactLinkTokens('/api/scheduling/availability?typeKey=consult'))
      .toBe('/api/scheduling/availability?typeKey=consult')
  })
})

describe('redactEventLinkTokens', () => {
  /**
   * What the SDK actually builds. HttpContext.preprocessEvent assigns
   * `url: getLocationHref()` — the full href, query string included — which is
   * why deleting `query_string` is not enough.
   */
  function eventForPage(href: string) {
    return {
      request: { url: href, headers: { Referer: href } },
      transaction: href,
      breadcrumbs: [
        { category: 'navigation', data: { from: '/', to: href } },
        { category: 'fetch', data: { url: `/api/sign/${SIGNING_TOKEN}`, status_code: 500 } },
      ],
      exception: {
        values: [{ type: 'TypeError', value: `Failed to fetch ${href}` }],
      },
      contexts: { trace: { data: { 'url.full': href } } },
      spans: [{ description: 'GET /api/sign', data: { 'http.url': `/api/sign/${SIGNING_TOKEN}` } }],
    }
  }

  const pages = {
    signing: `https://portal.example.com/sign/${SIGNING_TOKEN}`,
    manage: `https://portal.example.com/book/manage/${MANAGE_TOKEN}`,
    invite: `https://portal.example.com/intake/auth?invite=${INVITE_TOKEN}`,
  }

  for (const [name, href] of Object.entries(pages)) {
    it(`leaves no trace of the ${name} token anywhere in the event`, () => {
      const scrubbed = JSON.stringify(redactEventLinkTokens(eventForPage(href)))
      expect(scrubbed).not.toContain(SIGNING_TOKEN)
      expect(scrubbed).not.toContain(MANAGE_TOKEN)
      expect(scrubbed).not.toContain('c2lnbmF0dXJlX3NlY3JldA')
      expect(scrubbed).toContain(REDACTED)
    })
  }

  it('survives a cyclic event rather than hanging the hook', () => {
    const event: Record<string, unknown> = { request: { url: pages.signing } }
    event.self = event
    expect(() => redactEventLinkTokens(event)).not.toThrow()
    expect((event.request as { url: string }).url).toBe(`https://portal.example.com/sign/${REDACTED}`)
  })
})

describe('every Sentry config is wired to the scrubber', () => {
  // The bug this fixes was a field missing from a hand-written list in three
  // near-identical configs. A fourth runtime, or a rewrite of one of these,
  // should fail here rather than ship a quiet regression.
  const configs = ['instrumentation-client.ts', 'lib/sentry/server.ts', 'lib/sentry/edge.ts']

  for (const file of configs) {
    it(`${file} redacts both event kinds`, () => {
      // Assert against code, not prose: an earlier guard in this repo went red
      // on a comment that merely named the thing it forbids.
      const source = readFileSync(path.join(process.cwd(), file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')

      expect(source).toContain("from '@/lib/sentry/redact'")
      for (const hook of ['beforeSend(event)', 'beforeSendTransaction(event)']) {
        const start = source.indexOf(hook)
        expect(start, `${file} has no ${hook}`).toBeGreaterThan(-1)
        // Stop at the hook's own closing brace, so one hook calling the
        // scrubber cannot vouch for the other.
        const rest = source.slice(start)
        const body = rest.slice(0, rest.indexOf('\n    },'))
        expect(body, `${hook} does not scrub`).toContain('redactEventLinkTokens(event)')
      }
    })
  }
})
