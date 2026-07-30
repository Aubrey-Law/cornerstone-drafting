import { NextResponse } from 'next/server'
import { processDueScheduledEmails } from '@/lib/email/scheduled'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    return NextResponse.json({ ok: true, ...(await processDueScheduledEmails()) })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Scheduled email processing failed' },
      { status: 500 },
    )
  }
}
