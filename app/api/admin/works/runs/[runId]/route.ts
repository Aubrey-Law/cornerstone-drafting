import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { worksDb } from '@/lib/works/data'
import { artifactClientShape, type WorkRunArtifactRow } from '@/lib/works/artifacts'

export async function GET(req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  const { runId } = await params
  const { data, error } = await worksDb().from('work_runs').select('*, work_skills(*)').eq('id', runId).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  const { data: artifacts } = await worksDb().from('work_run_artifacts').select('*').eq('run_id', runId).order('created_at')
  return NextResponse.json({ run: data, artifacts: ((artifacts ?? []) as WorkRunArtifactRow[]).map(artifactClientShape) })
}
