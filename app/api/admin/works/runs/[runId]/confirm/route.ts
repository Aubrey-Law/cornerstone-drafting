import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { worksDb } from '@/lib/works/data'
import { promoteRunArtifacts } from '@/lib/works/artifacts'

export async function POST(req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { runId } = await params
  const db = worksDb()
  const { data: run } = await db.from('work_runs').select('id, status, matter_id, created_by, input_snapshot, work_skills(skill_type, slug)').eq('id', runId).maybeSingle()
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  if (run.status === 'confirmed') return NextResponse.json({ run, promoted: [] })
  if (!['awaiting_confirmation', 'completed'].includes(run.status)) return NextResponse.json({ error: 'Run is not awaiting confirmation' }, { status: 409 })
  let review: unknown = null
  const skillType = Array.isArray(run.work_skills) ? run.work_skills[0]?.skill_type : run.work_skills?.skill_type
  const skillSlug = Array.isArray(run.work_skills) ? run.work_skills[0]?.slug : run.work_skills?.slug
  const proposal = run.input_snapshot?.tabular_review_proposal
  if (skillType === 'tabular' && run.matter_id && proposal && Array.isArray(proposal.columns_config)) {
    const result = await db.from('tabular_reviews').insert({
      matter_id: run.matter_id,
      title: typeof proposal.title === 'string' ? proposal.title : 'Works tabular review',
      columns_config: proposal.columns_config,
      document_ids: Array.isArray(proposal.document_ids) ? proposal.document_ids : [],
      created_by: run.created_by ?? auth.userId,
    }).select('*').single()
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 })
    review = result.data
  }
  let promoted: Array<{ artifactId: string; documentId: string }> = []
  if (skillSlug === 'prepare-pmps-package') {
    if (!run.matter_id) return NextResponse.json({ error: 'PMPS run is missing its matter.' }, { status: 409 })
    try {
      promoted = await promoteRunArtifacts({ runId, matterId: run.matter_id, userId: auth.userId })
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to promote PMPS documents' }, { status: 500 })
    }
  }
  const { data, error } = await db.from('work_runs').update({ status: 'confirmed', confirmation_state: 'confirmed', confirmed_by: auth.userId, confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', runId).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ run: data, review, promoted })
}
