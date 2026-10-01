import { NextResponse } from 'next/server'
import { processWorkflowJobs } from '@/lib/workflowJobs'
import { runSystemAutomation } from '@/lib/automations/control'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function handle(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    return NextResponse.json({ ok: true, ...(await processWorkflowJobs(10)) })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Workflow processing failed' },
      { status: 500 },
    )
  }
}

export async function GET(req: Request) {
  return runSystemAutomation('workflow-jobs', req, () => handle(req), { leaseSeconds: 120 })
}
