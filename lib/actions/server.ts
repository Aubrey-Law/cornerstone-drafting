import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { getActionDefinition } from '@/lib/actions/registry'
import { ActionServiceError } from '@/lib/actions/errors'
import {
  confirmationPolicyForAutonomy,
  confirmationPolicyForRisk,
  isActingAutonomy,
  parseActionAutonomy,
} from '@/lib/actions/autonomy'
import { resolveActionAutonomy } from '@/lib/actions/delegation'
import type {
  ActionActor,
  ActionAutonomy,
  ActionConfirmationPolicy,
  ActionExecutionRequest,
  ActionProposalRequest,
} from '@/lib/actions/types'

export { ActionServiceError } from '@/lib/actions/errors'
export { confirmationPolicyForRisk } from '@/lib/actions/autonomy'

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, stableValue(entry)]))
  }
  return value
}

export function actionDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex')
}

function publicProposal(row: Record<string, unknown>) {
  const { reference_payload: _referencePayload, ...proposal } = row
  return proposal
}

function executionContext(
  actor: ActionActor,
  source: ActionProposalRequest['source'],
  idempotencyKey: string,
) {
  return { admin: getAdminClient(), actor, source: source ?? 'api', idempotencyKey }
}

async function assertStaffActor(actor: ActionActor) {
  const { data, error } = await getAdminClient().from('users').select('role').eq('id', actor.id).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data || !['admin', 'attorney'].includes(data.role)) {
    throw new ActionServiceError('Action requires authorized staff', 'forbidden', 403)
  }
}

export async function createActionProposal(request: ActionProposalRequest, actor: ActionActor) {
  await assertStaffActor(actor)
  const definition = getActionDefinition(request.actionKey)
  if (!definition) throw new Error('Unsupported action')
  if (definition.risk === 'prohibited') throw new Error('This action can only be recommended')
  const input = definition.validate(request.referencePayload, actor)
  const idempotencyKey = request.idempotencyKey?.trim() || `${request.actionKey}:${randomUUID()}`
  const context = executionContext(actor, request.source, idempotencyKey)
  const preview = await definition.preview(input, context)
  const previewDigest = actionDigest(preview.display)
  // The delegation dial speaks only for unattended callers. A proposal a
  // person is about to click keeps the confirmation its risk level demands.
  const autonomy: ActionAutonomy = request.applyAutonomy
    ? await resolveActionAutonomy(definition.key, definition.risk, request.autonomyCeiling)
    : 'propose'
  const confirmationPolicy = request.applyAutonomy
    ? confirmationPolicyForAutonomy(autonomy, definition.risk)
    : confirmationPolicyForRisk(definition.risk)
  const expiresAt = request.expiresAt && Number.isFinite(Date.parse(request.expiresAt))
    ? new Date(request.expiresAt).toISOString()
    : undefined
  const { data, error } = await getAdminClient().from('action_proposals').insert({
    actor_id: actor.id,
    action_key: definition.key,
    risk: definition.risk,
    status: autonomy === 'observe' ? 'observed' : 'pending',
    record_type: request.recordType ?? 'firm',
    record_id: request.recordId ?? null,
    reference_payload: input,
    display_summary: request.displaySummary.trim().slice(0, 500),
    idempotency_key: idempotencyKey,
    source: request.source ?? 'api',
    preview_digest: previewDigest,
    confirmation_policy: confirmationPolicy,
    autonomy,
    automation_run_id: request.automationRunId ?? null,
    ...(expiresAt ? { expires_at: expiresAt } : {}),
  }).select('*').single()
  if (error) {
    if (error.code === '23505') {
      const { data: existing } = await getAdminClient().from('action_proposals')
        .select('*').eq('idempotency_key', idempotencyKey).maybeSingle()
      if (existing) {
        if (
          existing.actor_id !== actor.id
          || existing.action_key !== definition.key
          || actionDigest(existing.reference_payload) !== actionDigest(input)
          || existing.automation_run_id !== (request.automationRunId ?? null)
        ) {
          throw new ActionServiceError('Idempotency key already belongs to a different action', 'idempotency_conflict')
        }
        if (existing.status === 'pending' && existing.preview_digest !== previewDigest) {
          throw new ActionServiceError('Existing action proposal is stale. Prepare a new proposal.', 'stale_preview')
        }
        const duplicate = {
          proposal: publicProposal(existing),
          preview,
          confirmation: { policy: existing.confirmation_policy, digest: existing.preview_digest },
          autonomy: parseActionAutonomy(existing.autonomy) ?? 'propose',
          execution: null as Record<string, unknown> | null,
          result: undefined as unknown,
          duplicate: true,
        }
        // A retried unattended run may find the proposal its failed earlier
        // attempt left pending. The dial as it stands now decides whether to
        // act on it; a card that needs an exact confirmation stays a card.
        if (
          request.applyAutonomy
          && existing.status === 'pending'
          && isActingAutonomy(autonomy)
          && existing.confirmation_policy !== 'explicit'
          && existing.confirmation_policy !== 'never'
        ) {
          const executed = await executeActionProposal(String(existing.id), actor)
          return {
            ...duplicate,
            proposal: executed.proposal,
            execution: (executed.execution ?? null) as Record<string, unknown> | null,
            result: executed.result,
          }
        }
        return duplicate
      }
    }
    throw new Error(error.message)
  }
  const created = {
    proposal: publicProposal(data),
    preview,
    confirmation: { policy: confirmationPolicy, digest: previewDigest },
    autonomy,
    execution: null as Record<string, unknown> | null,
    result: undefined as unknown,
    duplicate: false,
  }
  if (!isActingAutonomy(autonomy)) return created
  // An acting position was granted in Settings for this action's risk level,
  // so the same gate that would wait for a click runs the action now. The
  // execution still re-reads state, claims idempotency, and writes the audit.
  const executed = await executeActionProposal(String(data.id), actor)
  return {
    ...created,
    proposal: executed.proposal,
    execution: (executed.execution ?? null) as Record<string, unknown> | null,
    result: executed.result,
  }
}

export async function getActionProposalPreview(proposalId: string, actor: ActionActor) {
  await assertStaffActor(actor)
  const admin = getAdminClient()
  const { data: proposal, error } = await admin.from('action_proposals').select('*')
    .eq('id', proposalId).eq('actor_id', actor.id).maybeSingle()
  if (error) throw new Error(error.message)
  if (!proposal) throw new ActionServiceError('Action proposal not found', 'not_found', 404)
  const definition = getActionDefinition(proposal.action_key)
  if (!definition) throw new ActionServiceError('Action executor is unavailable', 'unsupported_action')
  const input = definition.validate(proposal.reference_payload, actor)
  const preview = await definition.preview(input, executionContext(actor, proposal.source, proposal.idempotency_key))
  const currentDigest = actionDigest(preview.display)
  return {
    proposal: publicProposal(proposal),
    preview,
    confirmation: {
      policy: proposal.confirmation_policy as ActionConfirmationPolicy,
      digest: currentDigest,
      stale: proposal.preview_digest !== currentDigest,
    },
  }
}

export async function rejectActionProposal(proposalId: string, actor: ActionActor) {
  await assertStaffActor(actor)
  const { data, error } = await getAdminClient().from('action_proposals')
    .update({ status: 'rejected', rejected_at: new Date().toISOString() })
    .eq('id', proposalId).eq('actor_id', actor.id).eq('status', 'pending')
    .select('*').maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new ActionServiceError('Pending action proposal not found', 'not_found', 404)
  return { proposal: publicProposal(data) }
}

export async function executeActionProposal(
  proposalId: string,
  actor: ActionActor,
  request: ActionExecutionRequest = {},
) {
  await assertStaffActor(actor)
  const admin = getAdminClient()
  const { data: proposal, error } = await admin.from('action_proposals').select('*')
    .eq('id', proposalId).eq('actor_id', actor.id).maybeSingle()
  if (error) throw new Error(error.message)
  if (!proposal) throw new Error('Action proposal not found')
  if (proposal.status === 'executed') {
    const { data: execution } = await admin.from('action_executions').select('*')
      .eq('idempotency_key', proposal.idempotency_key).maybeSingle()
    return { proposal: publicProposal(proposal), execution, duplicate: true }
  }
  if (proposal.status === 'accepted') throw new Error('Action is already executing')
  if (proposal.status !== 'pending') throw new Error('Action proposal is not executable')
  if (Date.parse(proposal.expires_at) <= Date.now()) {
    await admin.from('action_proposals').update({ status: 'expired' }).eq('id', proposalId)
    throw new Error('Action proposal expired')
  }
  const definition = getActionDefinition(proposal.action_key)
  if (!definition || definition.risk === 'prohibited') throw new Error('Action executor is unavailable')
  const input = definition.validate(proposal.reference_payload, actor)
  const context = executionContext(actor, proposal.source, proposal.idempotency_key)
  // Re-read authoritative state immediately before reserving the idempotency
  // key. A user must approve a fresh preview after any material change.
  const executionPreview = await definition.preview(input, context)
  const currentDigest = actionDigest(executionPreview.display)
  if (proposal.preview_digest !== currentDigest) {
    throw new ActionServiceError('Action preview is stale. Review the action again.', 'stale_preview')
  }

  const { data: claimRows, error: claimError } = await admin.rpc('claim_action_execution', {
    p_proposal_id: proposalId,
    p_actor_id: actor.id,
    p_preview_digest: currentDigest,
    p_confirmation_digest: request.confirmationDigest ?? null,
  })
  if (claimError) {
    const message = claimError.message || 'Action could not be claimed'
    if (message.includes('confirmation')) throw new ActionServiceError(message, 'confirmation_required', 403)
    if (message.includes('stale')) throw new ActionServiceError(message, 'stale_preview')
    if (message.includes('expired')) throw new ActionServiceError(message, 'expired')
    throw new ActionServiceError(message, 'claim_failed')
  }
  const claim = (Array.isArray(claimRows) ? claimRows[0] : claimRows) as {
    execution_id?: string
    execution_status?: string
    duplicate?: boolean
  } | null
  if (!claim?.execution_id) throw new ActionServiceError('Action execution was not reserved', 'claim_failed')
  if (claim.duplicate) {
    const { data: execution } = await admin.from('action_executions').select('*').eq('id', claim.execution_id).maybeSingle()
    if (execution?.status === 'succeeded') return { proposal: publicProposal(proposal), execution, duplicate: true }
    throw new ActionServiceError(
      execution?.status === 'running' ? 'Action is already executing' : 'The previous execution failed; prepare a new proposal',
      execution?.status === 'running' ? 'already_executing' : 'previous_execution_failed',
    )
  }

  let result: unknown
  try {
    result = await definition.execute(input, context)
  } catch (executionError) {
    const message = executionError instanceof Error ? executionError.message : 'Action failed'
    await admin.rpc('finish_action_execution', {
      p_execution_id: claim.execution_id,
      p_actor_id: actor.id,
      p_status: 'failed',
      p_before_state: executionPreview.auditBefore,
      p_after_state: null,
      p_after_digest: null,
      p_error_code: 'execution_failed',
      p_error_summary: message.slice(0, 500),
    })
    throw executionError
  }

  // Do not rewrite a successful side effect as failed just because the audit
  // finalization encountered an outage. Leaving the reservation in `running`
  // is deliberately fail-closed: retries cannot duplicate the effect and an
  // operator can reconcile the audit row.
  const afterState = definition.auditResult?.(result) ?? executionPreview.auditAfter
  const { data: execution, error: finishError } = await admin.rpc('finish_action_execution', {
    p_execution_id: claim.execution_id,
    p_actor_id: actor.id,
    p_status: 'succeeded',
    p_before_state: executionPreview.auditBefore,
    p_after_state: afterState,
    p_after_digest: actionDigest(afterState),
    p_error_code: null,
    p_error_summary: null,
  })
  if (finishError) {
    throw new ActionServiceError(
      `Action completed, but its audit needs reconciliation: ${finishError.message}`,
      'audit_finalization_pending',
      503,
    )
  }
  return {
    proposal: publicProposal({ ...proposal, status: 'executed' }),
    execution,
    result,
    duplicate: false,
  }
}
