import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { getActionDefinition } from '@/lib/actions/registry'
import type { ActionActor, ActionProposalRequest } from '@/lib/actions/types'

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export async function createActionProposal(request: ActionProposalRequest, actor: ActionActor) {
  const definition = getActionDefinition(request.actionKey)
  if (!definition) throw new Error('Unsupported action')
  if (definition.risk === 'prohibited') throw new Error('This action can only be recommended')
  const input = definition.validate(request.referencePayload)
  const preview = await definition.preview(input, { admin: getAdminClient(), actor })
  const idempotencyKey = request.idempotencyKey?.trim() || `${request.actionKey}:${randomUUID()}`
  const { data, error } = await getAdminClient().from('action_proposals').insert({
    actor_id: actor.id,
    action_key: definition.key,
    risk: definition.risk,
    status: 'pending',
    record_type: request.recordType ?? 'firm',
    record_id: request.recordId ?? null,
    reference_payload: input,
    display_summary: request.displaySummary.trim().slice(0, 500),
    idempotency_key: idempotencyKey,
  }).select('*').single()
  if (error) {
    if (error.code === '23505') {
      const { data: existing } = await getAdminClient().from('action_proposals')
        .select('*').eq('idempotency_key', idempotencyKey).maybeSingle()
      if (existing) return { proposal: existing, preview }
    }
    throw new Error(error.message)
  }
  return { proposal: data, preview }
}

export async function executeActionProposal(proposalId: string, actor: ActionActor) {
  const admin = getAdminClient()
  const { data: proposal, error } = await admin.from('action_proposals').select('*')
    .eq('id', proposalId).eq('actor_id', actor.id).maybeSingle()
  if (error) throw new Error(error.message)
  if (!proposal) throw new Error('Action proposal not found')
  if (proposal.status === 'executed') {
    const { data: execution } = await admin.from('action_executions').select('*')
      .eq('idempotency_key', proposal.idempotency_key).maybeSingle()
    return { proposal, execution, duplicate: true }
  }
  if (proposal.status === 'accepted') throw new Error('Action is already executing')
  if (proposal.status !== 'pending') throw new Error('Action proposal is not executable')
  if (Date.parse(proposal.expires_at) <= Date.now()) {
    await admin.from('action_proposals').update({ status: 'expired' }).eq('id', proposalId)
    throw new Error('Action proposal expired')
  }
  const definition = getActionDefinition(proposal.action_key)
  if (!definition || definition.risk === 'prohibited') throw new Error('Action executor is unavailable')
  const input = definition.validate(proposal.reference_payload)
  const claimed = await admin.from('action_proposals').update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', proposalId).eq('status', 'pending').select('id').maybeSingle()
  if (claimed.error || !claimed.data) throw new Error(claimed.error?.message ?? 'Action is already executing')

  // Re-read current state at acceptance time; the preview shown when the
  // proposal was created may have gone stale.
  const executionPreview = await definition.preview(input, { admin, actor })
  const beforeDigest = digest(executionPreview)
  try {
    const result = await definition.execute(input, { admin, actor })
    const { data: execution, error: executionError } = await admin.from('action_executions').insert({
      proposal_id: proposalId,
      actor_id: actor.id,
      action_key: definition.key,
      risk: definition.risk,
      status: 'succeeded',
      idempotency_key: proposal.idempotency_key,
      record_type: proposal.record_type,
      record_id: proposal.record_id,
      before_digest: beforeDigest,
      after_digest: digest(result),
    }).select('*').single()
    if (executionError) throw new Error(executionError.message)
    await admin.from('action_proposals').update({ status: 'executed', executed_at: new Date().toISOString() }).eq('id', proposalId)
    return { proposal: { ...proposal, status: 'executed' }, execution, result, duplicate: false }
  } catch (executionError) {
    const message = executionError instanceof Error ? executionError.message : 'Action failed'
    await admin.from('action_executions').insert({
      proposal_id: proposalId, actor_id: actor.id, action_key: definition.key, risk: definition.risk,
      status: 'failed', idempotency_key: proposal.idempotency_key,
      record_type: proposal.record_type, record_id: proposal.record_id,
      before_digest: beforeDigest, error_code: 'execution_failed', error_summary: message.slice(0, 500),
    })
    await admin.from('action_proposals').update({ status: 'failed' }).eq('id', proposalId)
    throw executionError
  }
}
