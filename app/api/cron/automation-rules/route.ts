import { NextResponse } from 'next/server'
import { runSystemAutomation } from '@/lib/automations/control'
import { runDueAutomationRules } from '@/lib/automations/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function handle(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json({ ok: true, ...(await runDueAutomationRules()) })
}

export async function GET(req: Request) {
  return runSystemAutomation('automation-rules', req, () => handle(req), { leaseSeconds: 300 })
}
