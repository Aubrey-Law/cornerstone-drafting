import { NextResponse } from 'next/server'
import { runMeetingTranscriptSync } from '@/lib/meetings/transcriptSync'
import { runSystemAutomation } from '@/lib/automations/control'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// GET /api/cron/meeting-transcripts — read new Granola notes and Teams
// transcripts onto the matter or lead each meeting belonged to, and start the
// meeting follow-up for each. Invoked by the Vercel cron in vercel.json; Vercel
// sends `Authorization: Bearer ${CRON_SECRET}` when the env var is set.
//
// Always 200 with the sweep's ledger. The sweep is bounded (a few notes per
// run) and idempotent through meeting_transcript_imports, so what it did not
// reach is picked up next time rather than being an error to alert on.
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json(await runMeetingTranscriptSync())
}

export async function GET(req: Request) {
  return runSystemAutomation('meeting-transcripts', req, () => handle(req), { leaseSeconds: 290 })
}
