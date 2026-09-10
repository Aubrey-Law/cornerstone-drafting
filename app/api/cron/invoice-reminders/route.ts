import { NextResponse } from 'next/server'
import { prepareInvoiceReminderDrafts } from '@/lib/billing/prepareInvoiceReminders'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const result = await prepareInvoiceReminderDrafts()
    return NextResponse.json(result, { status: result.unavailable ? 503 : 200 })
  } catch {
    return NextResponse.json({ error: 'Reminder preparation unavailable' }, { status: 503 })
  }
}
