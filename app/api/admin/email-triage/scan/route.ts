import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { consumeRateLimit } from '@/lib/rateLimit'
import { runEmailTriageScan } from '@/lib/emailTriage/scan'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// POST /api/admin/email-triage/scan — the Refresh button.
export async function POST(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) {
    return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Abuse limiting only. The real guard against two overlapping scans is the
  // in-flight row inside runEmailTriageScan: consumeRateLimit fails open by
  // design and so cannot be trusted for correctness.
  const rl = await consumeRateLimit(
    { bucket: 'email_triage_scan', limit: 6, windowSeconds: 600 },
    auth.userId,
  )
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', code: 'rate_limited', retryAfter: rl.retryAfterSeconds },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }

  const result = await runEmailTriageScan({
    trigger: 'manual',
    actorId: auth.userId,
    userId: auth.userId,
  })
  return NextResponse.json(result)
}
