import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { reconcileLawmaticsAppointments } from '@/lib/integrations/lawmatics/reconcile'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  const supplied = Buffer.from(req.headers.get('authorization') ?? '')
  const expected = Buffer.from(`Bearer ${secret ?? ''}`)
  if (!secret || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const lawmatics = await reconcileLawmaticsAppointments(100)
    return NextResponse.json({ lawmatics: { scanned: lawmatics.scanned, enqueued: lawmatics.enqueued } })
  } catch {
    // Provider/database errors may carry protected data. Only aggregate counts
    // are public here; additional providers can add their own count envelope.
    return NextResponse.json({ error: 'Reconciliation unavailable' }, { status: 503 })
  }
}
