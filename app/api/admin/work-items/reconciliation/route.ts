import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { runWorkGraphReconciliation } from '@/lib/work/rolloutServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) {
    return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runWorkGraphReconciliation({ userId: auth.userId, trigger: 'manual' })
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('work graph reconciliation failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'The reconciliation could not be completed' },
      { status: 500 },
    )
  }
}
