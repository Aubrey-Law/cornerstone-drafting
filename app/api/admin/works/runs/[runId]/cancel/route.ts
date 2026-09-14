import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { worksDb } from '@/lib/works/data'
import { cancelRunArtifacts } from '@/lib/works/artifacts'
import { canTransitionRun, type WorkRunStatus } from '@/lib/works/run'

export async function POST(req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { runId } = await params
  const db = worksDb()
  const { data: run } = await db.from('work_runs').select('id, status').eq('id', runId).maybeSingle()
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  // The declared state machine, rather than a second hand-rolled copy of it.
  if (!canTransitionRun(run.status as WorkRunStatus, 'cancelled')) {
    return NextResponse.json({ error: 'Run cannot be cancelled' }, { status: 409 })
  }
  await cancelRunArtifacts(runId)
  const { data, error } = await db.from('work_runs').update({ status: 'cancelled', confirmation_state: 'rejected', updated_at: new Date().toISOString() }).eq('id', runId).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ run: data })
}
