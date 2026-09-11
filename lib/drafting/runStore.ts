import 'server-only'
import { randomUUID } from 'node:crypto'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { runRequestHash, summarizeRun, type DraftRun, type DraftRunOutcome } from './runState'
import { selectSupersededDraftIds } from './supersede'
import type { DraftingMetrics } from './metrics'

export async function draftRunMetrics(matterId: string): Promise<DraftingMetrics | null> {
  const { data, error } = await getAdminClient().rpc('draft_generation_metrics', { p_matter_id: matterId })
  if (error) return null
  return data as DraftingMetrics
}

export async function claimDraftRun(args: { id: string; matterId: string; actorId: string; revision: string; documents: string[] }) {
  const token = randomUUID()
  const { data, error } = await getAdminClient().rpc('claim_draft_generation_run', {
    p_id: args.id, p_matter_id: args.matterId, p_actor_id: args.actorId,
    p_revision: args.revision, p_request_hash: runRequestHash(args.revision, args.documents),
    p_documents: [...new Set(args.documents)].sort(), p_worker_token: token,
  })
  if (error) throw new Error(`Could not start this draft run: ${error.message}`)
  const run = data as DraftRun
  return { run, claimed: run.status === 'running' && run.worker_token === token }
}
export async function updateDraftRun(run: DraftRun, patch: { outcomes?: DraftRunOutcome[]; status?: DraftRun['status']; error?: string | null }) {
  const { data, error } = await getAdminClient().from('draft_generation_runs')
    .update({ ...patch, updated_at: new Date().toISOString(), lease_expires_at: new Date(Date.now() + 360_000).toISOString() })
    .eq('id', run.id).eq('worker_token', run.worker_token).eq('status', 'running').gt('lease_expires_at', new Date().toISOString())
    .select('id').maybeSingle()
  if (error || !data) throw new Error('This draft run is no longer active. Refresh its status before retrying.')
}
export async function latestDraftRun(matterId: string, id?: string | null): Promise<DraftRun | null> {
  let query = getAdminClient().from('draft_generation_runs').select('*').eq('matter_id', matterId)
  if (id) query = query.eq('id', id)
  const { data, error } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error('Draft run history could not be loaded. Try again.')
  const run = data as DraftRun | null
  if (!run || run.status !== 'running' || Date.parse(run.lease_expires_at) > Date.now()) return run
  // Recover a request killed between document commit and ledger/final-status
  // writes. Immutable output keys survive renames and document version edits.
  const admin = getAdminClient()
  const { data: documents, error: documentError } = await admin.from('matter_documents')
    .select('id, name, draft_run_output, marker_count').eq('generation_id', run.id)
  if (documentError) throw new Error('Saved output could not be reconciled. Try again.')
  const outcomes = [...run.outcomes]
  for (const doc of documents ?? []) {
    const filename = run.requested_documents.find(name => encodeURIComponent(name) === doc.draft_run_output)
    if (!filename) continue
    const index = outcomes.findIndex(outcome => outcome.filename === filename)
    const saved: DraftRunOutcome = { filename, name: doc.name, status: 'saved', documentId: doc.id, markerCount: doc.marker_count }
    if (index < 0) outcomes.push(saved); else outcomes[index] = saved
  }
  const status = summarizeRun(run.requested_documents, outcomes).status
  const recovered = { ...run, outcomes, status, error: status === 'completed' ? null : 'Run interrupted. Saved drafts are preserved. Retry the remaining documents.' }
  // Capture candidates before releasing this run. A newly started run must
  // never become a candidate for superseding by this recovery operation.
  const { data: prior } = await admin.from('matter_documents').select('id, name, generation_id')
    .eq('matter_id', run.matter_id).eq('source', 'firm').is('superseded_at', null)
  const ids = selectSupersededDraftIds({ priorDrafts: (prior ?? []).filter((doc: { generation_id: string | null }) => doc.generation_id !== run.id), regeneratedNames: outcomes.filter(o => o.status === 'saved').map(o => o.name), fullSet: false })
  // Only this expired owner may be recovered; a concurrent retry gets a new token.
  const { data: recoveredRow, error: recoveryError } = await admin.from('draft_generation_runs')
    .update({ outcomes, status, error: recovered.error, updated_at: new Date().toISOString() })
    .eq('id', run.id).eq('worker_token', run.worker_token).eq('status', 'running').lte('lease_expires_at', new Date().toISOString()).select('id').maybeSingle()
  if (recoveryError) throw new Error('Draft recovery could not finish. Try again.')
  if (!recoveredRow) return run
  if (ids.length) await admin.from('matter_documents').update({ superseded_at: new Date().toISOString() }).in('id', ids)
  return recovered
}
/** Never expose the execution token to browsers. */
export function publicDraftRun(run: DraftRun) {
  const visible = { id: run.id, matter_id: run.matter_id, source_revision: run.source_revision, requested_documents: run.requested_documents, status: run.status, outcomes: run.outcomes, lease_expires_at: run.lease_expires_at, created_at: run.created_at, updated_at: run.updated_at, error: run.error }
  return { ...visible, retryable: run.status !== 'completed' && (run.status !== 'running' || Date.parse(run.lease_expires_at) <= Date.now()) }
}
