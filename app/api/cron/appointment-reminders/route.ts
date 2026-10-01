import { NextResponse } from 'next/server'
import { sendDueReminders } from '@/lib/appointments/reminders'
import { runSystemAutomation } from '@/lib/automations/control'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/cron/appointment-reminders — email clients ahead of upcoming
// appointments (lead time from Scheduling settings; provider from Email
// settings, Resend by default). Invoked hourly by the Vercel cron in
// vercel.json; Vercel sends `Authorization: Bearer ${CRON_SECRET}`
// automatically when the env var is set.
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await sendDueReminders()
  return NextResponse.json({ ok: true, ...result })
}

export async function GET(req: Request) {
  return runSystemAutomation('appointment-reminders', req, () => handle(req), { leaseSeconds: 120 })
}
