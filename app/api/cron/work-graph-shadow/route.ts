import { NextResponse } from 'next/server'
import { firmTodayKey } from '@/lib/firmDate'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { runWorkGraphReconciliation } from '@/lib/work/rolloutServer'
import { runSystemAutomation } from '@/lib/automations/control'

export const dynamic = 'force-dynamic'
export const maxDuration = 240

// One aggregate-only shadow sample per staff user and firm business date.
// The idempotency key makes Vercel retries harmless.
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const firmDate = firmTodayKey(now)
  const { data, error } = await getAdminClient().from('users')
    .select('id')
    .in('role', ['admin', 'attorney'])
    .limit(25)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const results: Array<{ userId: string; ok: boolean; passed?: boolean; error?: string }> = []
  for (const row of data ?? []) {
    try {
      const result = await runWorkGraphReconciliation({
        userId: row.id,
        trigger: 'cron',
        now,
        idempotencyKey: `work-graph-shadow:${firmDate}:${row.id}`,
      })
      results.push({ userId: row.id, ok: true, passed: result.run.readinessPassed })
    } catch (cause) {
      console.error('scheduled work graph reconciliation failed', { userId: row.id, cause })
      results.push({
        userId: row.id,
        ok: false,
        error: cause instanceof Error ? cause.message.slice(0, 300) : 'Unknown error',
      })
    }
  }

  const failed = results.filter(result => !result.ok)
  return NextResponse.json({
    ok: failed.length === 0,
    firmDate,
    sampled: results.length,
    passed: results.filter(result => result.passed).length,
    failed: failed.length,
  }, { status: failed.length ? 207 : 200 })
}

export async function GET(req: Request) {
  return runSystemAutomation('work-graph-shadow', req, () => handle(req), { leaseSeconds: 300 })
}
