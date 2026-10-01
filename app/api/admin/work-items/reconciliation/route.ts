import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { listWorkGraphReconciliationRuns, runWorkGraphReconciliation } from '@/lib/work/rolloutServer'
import { loadFirmSettings } from '@/lib/firmSettings'
import { calculateCommandCenterCutoverReadiness } from '@/lib/work/cutover'
import { listCommandCenterUsage } from '@/lib/work/usageServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) {
    return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runWorkGraphReconciliation({ userId: auth.userId, trigger: 'manual' })
    const [settings, runs, usage] = await Promise.all([
      loadFirmSettings(true),
      listWorkGraphReconciliationRuns(auth.userId, 100),
      listCommandCenterUsage(auth.userId),
    ])
    const cutoverReadiness = calculateCommandCenterCutoverReadiness({
      enabledAt: settings.commandCenterV2EnabledAt,
      cutoverAt: settings.commandCenterCutoverAt,
      runs,
      usage,
    })
    return NextResponse.json({ ...result, cutoverReadiness }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('work graph reconciliation failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'The reconciliation could not be completed' },
      { status: 500 },
    )
  }
}
