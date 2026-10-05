import 'server-only'

import { ADMIN_EMAIL, getAdminClient } from '@/lib/supabaseAdmin'
import { getActionDefinition, listActionDefinitions } from '@/lib/actions/registry'
import { ActionServiceError } from '@/lib/actions/errors'
import {
  ACTION_CATALOG,
  actionLabel,
  autonomyCeilingForRisk,
  clampAutonomy,
  compareAutonomy,
  defaultAutonomyForAction,
  minAutonomy,
  parseActionAutonomy,
} from '@/lib/actions/autonomy'
import type { ActionActor, ActionAutonomy, ActionRisk } from '@/lib/actions/types'

/**
 * The delegation dial's server side: the firm's stored positions, the activity
 * the dial produced, and the undo of a delegated execution.
 */

export async function loadActionAutonomySettings(): Promise<Record<string, ActionAutonomy>> {
  const { data, error } = await getAdminClient().from('action_autonomy_settings').select('action_key, autonomy')
  if (error) throw new Error(error.message)
  const settings: Record<string, ActionAutonomy> = {}
  for (const row of data ?? []) {
    const level = parseActionAutonomy(row.autonomy)
    if (level && typeof row.action_key === 'string') settings[row.action_key] = level
  }
  return settings
}

/**
 * The position that applies to one unattended proposal. Fails closed: if the
 * settings cannot be read, the proposal waits for a person as it always has.
 */
export async function resolveActionAutonomy(
  actionKey: string,
  risk: ActionRisk,
  ceiling?: ActionAutonomy,
): Promise<ActionAutonomy> {
  const fallback = defaultAutonomyForAction(actionKey)
  let stored: ActionAutonomy = fallback
  try {
    stored = (await loadActionAutonomySettings())[actionKey] ?? fallback
  } catch (error) {
    console.error('delegation settings unavailable; using the action\u2019s default position', {
      actionKey,
      cause: error instanceof Error ? error.message : String(error),
    })
    stored = fallback
  }
  const level = clampAutonomy(stored, risk)
  return ceiling ? minAutonomy(level, ceiling) : level
}

/**
 * The staff user an unattended run acts as when nothing else names one: the
 * firm's attorney, else any administrator. Null when the firm has no staff
 * user at all, in which case nothing delegated can run.
 */
export async function resolveUnattendedActor(): Promise<ActionActor | null> {
  const admin = getAdminClient()
  const { data: primary, error } = await admin.from('users').select('id, email')
    .eq('email', ADMIN_EMAIL).in('role', ['admin', 'attorney']).maybeSingle()
  if (error) throw new Error(error.message)
  if (primary) return { id: primary.id, email: primary.email }
  const { data: fallback, error: fallbackError } = await admin.from('users').select('id, email')
    .eq('role', 'admin').order('created_at', { ascending: true }).limit(1).maybeSingle()
  if (fallbackError) throw new Error(fallbackError.message)
  return fallback ? { id: fallback.id, email: fallback.email } : null
}

export interface DelegationSetting {
  key: string
  risk: ActionRisk
  label: string
  description: string
  group: string
  autonomy: ActionAutonomy
  ceiling: ActionAutonomy
  undoable: boolean
}

export async function listDelegationSettings(): Promise<DelegationSetting[]> {
  const stored = await loadActionAutonomySettings()
  return listActionDefinitions()
    .filter(({ risk }) => risk !== 'prohibited')
    .map(({ key, risk }) => {
      const catalog = ACTION_CATALOG[key]
      return {
        key,
        risk,
        label: catalog?.label ?? key,
        description: catalog?.description ?? '',
        group: catalog?.group ?? 'records',
        autonomy: clampAutonomy(stored[key] ?? defaultAutonomyForAction(key), risk),
        ceiling: autonomyCeilingForRisk(risk),
        undoable: Boolean(getActionDefinition(key)?.undo),
      }
    })
}

export async function setActionAutonomy(actionKey: string, level: ActionAutonomy, actorId: string) {
  const definition = getActionDefinition(actionKey)
  if (!definition || definition.risk === 'prohibited') {
    throw new ActionServiceError('Unknown action', 'unknown_action', 404)
  }
  const ceiling = autonomyCeilingForRisk(definition.risk)
  if (compareAutonomy(level, ceiling) > 0) {
    throw new ActionServiceError(
      `This action can go no further than "${ceiling.replace('_', ' ')}" because of its risk level`,
      'above_ceiling',
      400,
    )
  }
  const { data, error } = await getAdminClient().from('action_autonomy_settings')
    .upsert({ action_key: actionKey, autonomy: level, updated_by: actorId }, { onConflict: 'action_key' })
    .select('action_key, autonomy, updated_at').single()
  if (error) throw new Error(error.message)
  return data
}

export interface DelegatedActivityItem {
  executionId: string | null
  proposalId: string
  actionKey: string
  label: string
  summary: string
  status: string
  recordType: string | null
  recordId: string | null
  href: string | null
  createdAt: string
  completedAt: string | null
  undoneAt: string | null
  undoable: boolean
  errorSummary: string | null
}

export interface ObservedActivityItem {
  proposalId: string
  actionKey: string
  label: string
  summary: string
  recordType: string | null
  recordId: string | null
  href: string | null
  createdAt: string
}

function recordHref(recordType: string | null, recordId: string | null): string | null {
  if (!recordId) return null
  if (recordType === 'matter') return `/admin/matters/${recordId}`
  if (recordType === 'lead') return `/admin/leads/${recordId}`
  return null
}

/**
 * What the dial did on its own. Only "act and report" positions appear here;
 * "act silently" leaves the audit tables as its only trace, by definition.
 */
export async function listDelegatedActivity(options: { since: Date; limit?: number }): Promise<{
  done: DelegatedActivityItem[]
  observed: ObservedActivityItem[]
}> {
  const admin = getAdminClient()
  const limit = options.limit ?? 20
  const since = options.since.toISOString()
  const columns = 'id, action_key, status, record_type, record_id, display_summary, created_at'
  const [doneResult, observedResult] = await Promise.all([
    admin.from('action_proposals').select(columns)
      .eq('autonomy', 'act_report')
      .in('status', ['accepted', 'executed', 'failed'])
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(limit),
    admin.from('action_proposals').select(columns)
      .eq('status', 'observed')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(limit),
  ])
  if (doneResult.error) throw new Error(doneResult.error.message)
  if (observedResult.error) throw new Error(observedResult.error.message)

  const proposals = (doneResult.data ?? []) as Array<Record<string, unknown>>
  const ids = proposals.map(row => String(row.id))
  const executionsResult = ids.length
    ? await admin.from('action_executions')
      .select('id, proposal_id, status, completed_at, undone_at, error_summary')
      .in('proposal_id', ids)
    : { data: [], error: null }
  if (executionsResult.error) throw new Error(executionsResult.error.message)
  const executions = new Map<string, Record<string, unknown>>()
  for (const row of (executionsResult.data ?? []) as Array<Record<string, unknown>>) {
    if (typeof row.proposal_id === 'string') executions.set(row.proposal_id, row)
  }

  const done = proposals.map(row => {
    const actionKey = String(row.action_key)
    const execution = executions.get(String(row.id)) ?? null
    const status = typeof execution?.status === 'string' ? execution.status : String(row.status)
    const recordType = typeof row.record_type === 'string' ? row.record_type : null
    const recordId = typeof row.record_id === 'string' ? row.record_id : null
    return {
      executionId: typeof execution?.id === 'string' ? execution.id : null,
      proposalId: String(row.id),
      actionKey,
      label: actionLabel(actionKey),
      summary: String(row.display_summary ?? ''),
      status,
      recordType,
      recordId,
      href: recordHref(recordType, recordId),
      createdAt: String(row.created_at),
      completedAt: typeof execution?.completed_at === 'string' ? execution.completed_at : null,
      undoneAt: typeof execution?.undone_at === 'string' ? execution.undone_at : null,
      undoable: status === 'succeeded' && Boolean(getActionDefinition(actionKey)?.undo),
      errorSummary: typeof execution?.error_summary === 'string' ? execution.error_summary : null,
    }
  })

  const observed = ((observedResult.data ?? []) as Array<Record<string, unknown>>).map(row => {
    const actionKey = String(row.action_key)
    const recordType = typeof row.record_type === 'string' ? row.record_type : null
    const recordId = typeof row.record_id === 'string' ? row.record_id : null
    return {
      proposalId: String(row.id),
      actionKey,
      label: actionLabel(actionKey),
      summary: String(row.display_summary ?? ''),
      recordType,
      recordId,
      href: recordHref(recordType, recordId),
      createdAt: String(row.created_at),
    }
  })

  return { done, observed }
}

async function assertStaffActor(actor: ActionActor) {
  const { data, error } = await getAdminClient().from('users').select('role').eq('id', actor.id).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data || !['admin', 'attorney'].includes(data.role)) {
    throw new ActionServiceError('Undo requires authorized staff', 'forbidden', 403)
  }
}

/**
 * Reverses one succeeded execution through the action's own inverse. The row
 * keeps its before/after audit and gains who undid it and when.
 */
export async function undoActionExecution(executionId: string, actor: ActionActor) {
  await assertStaffActor(actor)
  const admin = getAdminClient()
  const { data: execution, error } = await admin.from('action_executions').select('*').eq('id', executionId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!execution) throw new ActionServiceError('Action execution not found', 'not_found', 404)
  if (execution.status === 'undone') return { execution, duplicate: true }
  if (execution.status !== 'succeeded') {
    throw new ActionServiceError('Only a completed action can be undone', 'not_undoable', 409)
  }
  const definition = getActionDefinition(execution.action_key)
  if (!definition?.undo) throw new ActionServiceError('This action has no undo', 'not_undoable', 409)
  if (!execution.proposal_id) throw new ActionServiceError('The original request is no longer available', 'not_undoable', 409)
  const { data: proposal, error: proposalError } = await admin.from('action_proposals')
    .select('reference_payload, source').eq('id', execution.proposal_id).maybeSingle()
  if (proposalError) throw new Error(proposalError.message)
  if (!proposal) throw new ActionServiceError('The original request is no longer available', 'not_undoable', 409)

  const input = definition.validate(proposal.reference_payload, actor)
  const result = await definition.undo(input, {
    beforeState: (execution.before_state ?? null) as Record<string, unknown> | null,
    afterState: (execution.after_state ?? null) as Record<string, unknown> | null,
  }, {
    admin,
    actor,
    source: (execution.source ?? 'api') as 'api' | 'today' | 'record' | 'assistant' | 'automation',
    idempotencyKey: `undo:${execution.idempotency_key}`,
  })

  const { data: updated, error: updateError } = await admin.from('action_executions')
    .update({ status: 'undone', undone_at: new Date().toISOString(), undone_by: actor.id })
    .eq('id', executionId).eq('status', 'succeeded')
    .select('*').maybeSingle()
  if (updateError) {
    throw new ActionServiceError(
      `The action was undone, but its audit needs reconciliation: ${updateError.message}`,
      'audit_finalization_pending',
      503,
    )
  }
  return { execution: updated ?? { ...execution, status: 'undone' }, result: result ?? null, duplicate: false }
}
