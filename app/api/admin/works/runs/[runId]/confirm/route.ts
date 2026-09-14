import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { worksDb } from '@/lib/works/data'
import { promoteRunArtifacts } from '@/lib/works/artifacts'
import { ensureMetlifeClaimItem } from '@/lib/metlife/ledger'
import { canTransitionRun, type WorkRunStatus } from '@/lib/works/run'

export async function POST(req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { runId } = await params
  const db = worksDb()
  const { data: run } = await db.from('work_runs').select('id, status, matter_id, created_by, input_snapshot, work_skills(skill_type, slug)').eq('id', runId).maybeSingle()
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  if (run.status === 'confirmed') return NextResponse.json({ run, promoted: [] })
  if (!canTransitionRun(run.status as WorkRunStatus, 'confirmed')) {
    return NextResponse.json({ error: 'Run is not awaiting confirmation' }, { status: 409 })
  }
  let review: unknown = null
  const skillType = Array.isArray(run.work_skills) ? run.work_skills[0]?.skill_type : run.work_skills?.skill_type
  const skillSlug = Array.isArray(run.work_skills) ? run.work_skills[0]?.slug : run.work_skills?.slug
  const proposal = run.input_snapshot?.tabular_review_proposal
  // Confirmation has several side effects and only flips the run at the end, so
  // a failure part-way through leaves the earlier ones committed. Record the
  // review we created, and skip it on a retry rather than inserting a second.
  const existingReviewId = typeof run.input_snapshot?.tabular_review_id === 'string'
    ? run.input_snapshot.tabular_review_id
    : null
  if (existingReviewId) {
    const { data: already } = await db.from('tabular_reviews').select('*').eq('id', existingReviewId).maybeSingle()
    review = already ?? null
  }
  if (!review && skillType === 'tabular' && run.matter_id && proposal && Array.isArray(proposal.columns_config)) {
    const result = await db.from('tabular_reviews').insert({
      matter_id: run.matter_id,
      title: typeof proposal.title === 'string' ? proposal.title : 'Works tabular review',
      columns_config: proposal.columns_config,
      document_ids: Array.isArray(proposal.document_ids) ? proposal.document_ids : [],
      created_by: run.created_by ?? auth.userId,
    }).select('*').single()
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 })
    review = result.data
    await db.from('work_runs').update({
      input_snapshot: { ...run.input_snapshot, tabular_review_id: (result.data as { id?: string }).id },
      updated_at: new Date().toISOString(),
    }).eq('id', runId)
  }
  let promoted: Array<{ artifactId: string; documentId: string }> = []
  const generatesDocuments = skillSlug === 'prepare-pmps-package' || skillSlug === 'prepare-metlife-claim'
  if (generatesDocuments) {
    if (!run.matter_id) return NextResponse.json({ error: 'This run is missing its matter.' }, { status: 409 })
    try {
      promoted = await promoteRunArtifacts({ runId, matterId: run.matter_id, userId: auth.userId })
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to promote the generated documents' }, { status: 500 })
    }
  }

  // Confirming a MetLife claim is what files it: until the attorney reviews the
  // document, the ledger should not show money the firm has not decided to claim.
  let claim: { itemId: string; created: boolean; amountCents: number } | null = null
  if (skillSlug === 'prepare-metlife-claim' && run.matter_id) {
    const amountCents = Number(run.input_snapshot?.metlife?.grandTotalCents)
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      return NextResponse.json({ error: 'This MetLife run has no computed claim total to file.' }, { status: 409 })
    }
    try {
      claim = await ensureMetlifeClaimItem({ matterId: run.matter_id, amountCents, userId: auth.userId })
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to file the MetLife claim' }, { status: 500 })
    }
  }
  const { data, error } = await db.from('work_runs').update({ status: 'confirmed', confirmation_state: 'confirmed', confirmed_by: auth.userId, confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', runId).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ run: data, review, promoted, claim })
}
