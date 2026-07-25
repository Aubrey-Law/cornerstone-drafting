import 'server-only'
import { NextResponse } from 'next/server'
import { consumeRateLimit } from '@/lib/rateLimit'

/**
 * Shared protection for the anonymous scheduling endpoints: per-IP fixed
 * window rate limit (durable, via rate_limits) keyed by route bucket.
 */
export async function guardPublicSchedulingRoute(
  req: Request,
  bucket: string,
  limit: number,
): Promise<NextResponse | null> {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'

  const rl = await consumeRateLimit({ bucket, limit, windowSeconds: 60 }, ip)
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds || 60) } },
    )
  }
  return null
}
