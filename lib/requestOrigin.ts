// Resolve the public-facing origin for a request. `req.nextUrl.origin` is
// unreliable behind reverse proxies and hosting adapters because it
// can return the pod's internal listen address (`http://0.0.0.0:PORT`).
//
// Strategy:
//   1. Honour standard X-Forwarded-Host / X-Forwarded-Proto headers.
//   2. Fall back to the Host header.
//   3. Last resort: derive from a known public env URL (the OAuth redirect
//      URIs we register with Google / Microsoft are always public).
//   4. Final fallback: whatever Next surfaced as the URL origin.

import type { NextRequest } from 'next/server'

const PUBLIC_ORIGIN_ENV_KEYS = [
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_SITE_URL',
] as const

function isLoopbackHost(host: string): boolean {
  return host.includes('0.0.0.0') || host.includes('127.0.0.1') || host.startsWith('localhost')
}

function originFromEnv(): string | null {
  for (const key of PUBLIC_ORIGIN_ENV_KEYS) {
    const v = process.env[key]
    if (!v) continue
    try {
      return new URL(v).origin
    } catch {
      // ignore malformed values
    }
  }
  return null
}

export function getRequestOrigin(req: Request | NextRequest): string {
  const xfHost = req.headers.get('x-forwarded-host')
  const xfProto = req.headers.get('x-forwarded-proto')
  if (xfHost) {
    return `${xfProto || 'https'}://${xfHost.split(',')[0].trim()}`
  }

  const host = req.headers.get('host')
  if (host && !isLoopbackHost(host)) {
    return `https://${host}`
  }

  const envOrigin = originFromEnv()
  if (envOrigin) return envOrigin

  if (host) return `http://${host}`

  if ('nextUrl' in req) {
    return (req as NextRequest).nextUrl.origin
  }
  return new URL((req as Request).url).origin
}
