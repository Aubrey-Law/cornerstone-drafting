import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { toResponse, unavailableResponse } from '@/lib/auth/respond'

const req = (path: string) => new NextRequest(`https://workbench.test${path}`)

describe('turning a gate decision into a response', () => {
  it('passes through', () => {
    const res = toResponse({ kind: 'pass' }, req('/matters'))
    expect(res).toBeNull()
  })

  it('redirects a navigation to the login page, remembering where it was going', () => {
    const res = toResponse({ kind: 'deny', status: 401 }, req('/matters/abc?tab=documents'))!
    expect(res.status).toBe(307)
    const location = new URL(res.headers.get('location')!)
    expect(location.pathname).toBe('/auth/login')
    expect(location.searchParams.get('redirectTo')).toBe('/matters/abc?tab=documents')
  })

  /**
   * fetch() follows redirects transparently, so a 307 to the login page arrives
   * at the call site as a 200 with an HTML body and res.ok true. Call sites that
   * do `await res.json().catch(() => [])` then render an empty list as though
   * the data were genuinely empty, instead of surfacing an expired session.
   */
  it('answers an API path with JSON, never a redirect', async () => {
    const res = toResponse({ kind: 'deny', status: 401 }, req('/api/staff/matters'))!
    expect(res.status).toBe(401)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
  })

  it('distinguishes forbidden from unauthorized in the body', async () => {
    const res = toResponse({ kind: 'deny', status: 403 }, req('/api/staff/matters'))!
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Forbidden' })
  })

  it('sends a forbidden navigation to login rather than showing a dead end', () => {
    const res = toResponse({ kind: 'deny', status: 403 }, req('/matters'))!
    expect(res.status).toBe(307)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/auth/login')
  })

  it('redirects where the decision says', () => {
    const res = toResponse({ kind: 'redirect', to: '/portal' }, req('/matters'))!
    expect(res.status).toBe(307)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/portal')
  })
})

describe('the unavailable response', () => {
  it('is 503 JSON for an API path', async () => {
    const res = unavailableResponse(req('/api/staff/matters'))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'Service Unavailable' })
  })

  it('is a 503 HTML page for a navigation', async () => {
    const res = unavailableResponse(req('/matters'))
    expect(res.status).toBe(503)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(await res.text()).toContain('temporarily unavailable')
  })

  it('does not reflect the requested path into the page', async () => {
    // The path is attacker-controlled; echoing it is a reflected-XSS foothold
    // for no benefit, since the page says nothing useful with it.
    const res = unavailableResponse(req('/matters/<script>alert(1)</script>'))
    expect(await res.text()).not.toContain('<script>alert(1)</script>')
  })
})
