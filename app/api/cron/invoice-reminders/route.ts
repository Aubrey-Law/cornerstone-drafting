import { NextResponse } from 'next/server'
import { prepareInvoiceReminderDrafts } from '@/lib/billing/prepareInvoiceReminders'
import { resolveUnattendedActor } from '@/lib/actions/delegation'
import { runSystemAutomation } from '@/lib/automations/control'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    // A cron run has no user. Delegated sends run as the firm's attorney, the
    // same person a manual approval would run as; with nobody to act as, the
    // drafts simply wait.
    const actorId = await resolveUnattendedActor().then(actor => actor?.id ?? null, () => null)
    const result = await prepareInvoiceReminderDrafts({ actorId })
    return NextResponse.json(result, { status: result.unavailable ? 503 : 200 })
  } catch {
    return NextResponse.json({ error: 'Reminder preparation unavailable' }, { status: 503 })
  }
}

export async function GET(req: Request) {
  return runSystemAutomation('invoice-reminders', req, () => handle(req), { leaseSeconds: 120 })
}
