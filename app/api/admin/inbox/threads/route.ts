import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { consumeRateLimit } from '@/lib/rateLimit'
import { fetchInboxThreads } from '@/lib/queries/inbox'

export async function GET(req: NextRequest) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const rate = await consumeRateLimit(
    { bucket: 'inbox_threads', limit: 120, windowSeconds: 60 },
    userId ?? 'anonymous',
  )
  if (!rate.ok) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } },
    )
  }

  const { searchParams } = new URL(req.url)
  const cursor = searchParams.get('cursor')
  const limitParam = Number(searchParams.get('limit') ?? '50')
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(1, Math.trunc(limitParam)), 200) : 50
  const includeArchived = searchParams.get('archived') === 'true'

  try {
    const threads = await fetchInboxThreads({ limit, cursor, includeArchived })
    return NextResponse.json({ threads })
  } catch (error) {
    console.error('[inbox] thread list error:', error)
    return NextResponse.json({ error: 'Failed to load threads' }, { status: 500 })
  }
}
