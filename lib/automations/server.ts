import 'server-only'

import { randomUUID } from 'node:crypto'
import { createActionProposal, executeActionProposal } from '@/lib/actions/server'
import type { ActionActor } from '@/lib/actions/types'
import { getAdminClient } from '@/lib/supabaseAdmin'
import {
  AUTOMATION_ACTION_KEYS,
  AUTOMATION_TRIGGER_KEYS,
  automationApprovalPolicy,
  nextSystemRunAt,
  type AutomationActionKey,
  type AutomationApprovalPolicy,
  type AutomationTriggerKey,
} from '@/lib/automations/registry'
import {
  evaluateAutomationRule,
  summarizeAutomationCandidates,
  type AutomationRuleRecord,
} from '@/lib/automations/evaluate'
import { redactOperationalError } from '@/lib/automations/control'

export type AutomationMode = 'dry_run' | 'live' | 'paused'

export interface AutomationRuleInput {
  name: string
  description?: string | null
  triggerKey: AutomationTriggerKey
  actionKey: AutomationActionKey
  conditions?: Record<string, unknown>
  actionConfig?: Record<string, unknown>
  mode?: AutomationMode
  approvalPolicy?: AutomationApprovalPolicy
  killSwitch?: boolean
  maxAttempts?: number
}

interface ClaimRow {
  run_id: string | null
  run_status: string
  duplicate: boolean
  claim_reason: string
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function normalizeRule(row: Record<string, unknown>): AutomationRuleRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    trigger_key: row.trigger_key as AutomationTriggerKey,
    action_key: row.action_key as AutomationActionKey,
    conditions: jsonObject(row.conditions),
    action_config: jsonObject(row.action_config),
    approval_policy: row.approval_policy as AutomationApprovalPolicy,
    mode: row.mode as AutomationMode,
    updated_by: typeof row.updated_by === 'string' ? row.updated_by : null,
    max_attempts: typeof row.max_attempts === 'number' ? row.max_attempts : 3,
  }
}

export function validateAutomationRule(value: unknown): AutomationRuleInput {
  const body = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name || name.length > 120) throw new Error('Automation name is required and must be 120 characters or fewer')
  if (!AUTOMATION_TRIGGER_KEYS.includes(body.triggerKey as AutomationTriggerKey)) throw new Error('Unsupported automation trigger')
  if (!AUTOMATION_ACTION_KEYS.includes(body.actionKey as AutomationActionKey)) throw new Error('Unsupported automation action')
  const actionKey = body.actionKey as AutomationActionKey
  const safestPolicy = automationApprovalPolicy(actionKey)
  const requestedPolicy = body.approvalPolicy
  const approvalPolicy: AutomationApprovalPolicy = safestPolicy === 'required'
    ? 'required'
    : requestedPolicy === 'required' || requestedPolicy === 'prohibited' ? requestedPolicy : 'automatic'
  const mode: AutomationMode = body.mode === 'live' || body.mode === 'paused' ? body.mode : 'dry_run'
  if (mode === 'live' && approvalPolicy === 'prohibited') throw new Error('A prohibited automation cannot run live')
  const maxAttempts = typeof body.maxAttempts === 'number' && Number.isFinite(body.maxAttempts)
    ? Math.max(1, Math.min(20, Math.round(body.maxAttempts)))
    : 3
  return {
    name,
    description: typeof body.description === 'string' ? body.description.trim().slice(0, 500) || null : null,
    triggerKey: body.triggerKey as AutomationTriggerKey,
    actionKey,
    conditions: jsonObject(body.conditions),
    actionConfig: jsonObject(body.actionConfig),
    mode,
    approvalPolicy,
    killSwitch: body.killSwitch === true,
    maxAttempts,
  }
}

export async function listAutomationRules() {
  const admin = getAdminClient()
  const { data: rules, error } = await admin.from('automation_rules').select('*')
    .order('origin').order('name')
  if (error) throw new Error(error.message)
  const ids = (rules ?? []).map(rule => rule.id as string)
  const { data: runs, error: runsError } = ids.length
    ? await admin.from('automation_runs').select('*').in('rule_id', ids).order('started_at', { ascending: false }).limit(1000)
    : { data: [], error: null }
  if (runsError) throw new Error(runsError.message)

  const runRows = (runs ?? []) as Array<Record<string, unknown>>
  const latest = new Map<string, Record<string, unknown>>()
  const latestSuccess = new Map<string, Record<string, unknown>>()
  const latestFailure = new Map<string, Record<string, unknown>>()
  const history = new Map<string, Record<string, unknown>[]>()
  for (const run of runRows) {
    const ruleId = typeof run.rule_id === 'string' ? run.rule_id : null
    if (!ruleId) continue
    if (!latest.has(ruleId)) latest.set(ruleId, run)
    if (run.status === 'succeeded' && !latestSuccess.has(ruleId)) latestSuccess.set(ruleId, run)
    if (run.status === 'failed' && !latestFailure.has(ruleId)) latestFailure.set(ruleId, run)
    const rows = history.get(ruleId) ?? []
    if (rows.length < 10) rows.push(run)
    history.set(ruleId, rows)
  }

  const runToRule = new Map(runRows.filter(run => typeof run.id === 'string' && typeof run.rule_id === 'string')
    .map(run => [run.id as string, run.rule_id as string]))
  const { data: pendingRows, error: pendingError } = await admin.from('action_proposals')
    .select('automation_run_id').eq('status', 'pending').not('automation_run_id', 'is', null)
  if (pendingError) throw new Error(pendingError.message)
  const pending = new Map<string, number>()
  for (const proposal of pendingRows ?? []) {
    const ruleId = proposal.automation_run_id ? runToRule.get(proposal.automation_run_id) : null
    if (ruleId) pending.set(ruleId, (pending.get(ruleId) ?? 0) + 1)
  }

  return (rules ?? []).map(rule => ({
    ...rule,
    next_run_at: rule.next_run_at ?? (typeof rule.system_key === 'string' && rule.system_key.startsWith('system:')
      ? nextSystemRunAt(rule.system_key.slice('system:'.length))?.toISOString() ?? null
      : null),
    lastRun: latest.get(rule.id as string) ?? null,
    lastSuccess: latestSuccess.get(rule.id as string) ?? null,
    lastFailure: latestFailure.get(rule.id as string) ?? null,
    pendingApprovals: pending.get(rule.id as string) ?? 0,
    recentRuns: history.get(rule.id as string) ?? [],
  }))
}

export async function createAutomationRule(input: AutomationRuleInput, actorId: string) {
  const { data, error } = await getAdminClient().from('automation_rules').insert({
    name: input.name,
    description: input.description ?? null,
    trigger_key: input.triggerKey,
    action_key: input.actionKey,
    conditions: input.conditions ?? {},
    action_config: input.actionConfig ?? {},
    mode: input.mode ?? 'dry_run',
    approval_policy: input.approvalPolicy ?? automationApprovalPolicy(input.actionKey),
    kill_switch: input.killSwitch ?? false,
    max_attempts: input.maxAttempts ?? 3,
    origin: 'custom_rule',
    created_by: actorId,
    updated_by: actorId,
  }).select('*').single()
  if (error) throw new Error(error.message)
  return data
}

export async function updateAutomationRule(ruleId: string, input: AutomationRuleInput, actorId: string) {
  const admin = getAdminClient()
  const { data: current, error: currentError } = await admin.from('automation_rules').select('*').eq('id', ruleId).maybeSingle()
  if (currentError) throw new Error(currentError.message)
  if (!current) throw new Error('Automation not found')
  const locked = current.locked === true
  const patch = locked ? {
    mode: input.mode ?? current.mode,
    kill_switch: input.killSwitch ?? false,
    updated_by: actorId,
  } : {
    name: input.name,
    description: input.description ?? null,
    trigger_key: input.triggerKey,
    action_key: input.actionKey,
    conditions: input.conditions ?? {},
    action_config: input.actionConfig ?? {},
    mode: input.mode ?? 'dry_run',
    approval_policy: input.approvalPolicy ?? automationApprovalPolicy(input.actionKey),
    kill_switch: input.killSwitch ?? false,
    max_attempts: input.maxAttempts ?? 3,
    updated_by: actorId,
  }
  const { data, error } = await admin.from('automation_rules').update(patch).eq('id', ruleId).select('*').single()
  if (error) throw new Error(error.message)
  return data
}

export async function updateAutomationControl(
  ruleId: string,
  value: unknown,
  actorId: string,
) {
  const body = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const mode: AutomationMode = body.mode === 'live' || body.mode === 'dry_run' || body.mode === 'paused'
    ? body.mode
    : 'paused'
  const killSwitch = body.killSwitch === true
  const { data, error } = await getAdminClient().from('automation_rules').update({
    mode,
    kill_switch: killSwitch,
    updated_by: actorId,
    next_run_at: mode === 'live' && !killSwitch ? new Date().toISOString() : null,
  }).eq('id', ruleId).select('*').maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Automation not found')
  return data
}

async function claimRuleRun(input: {
  rule: AutomationRuleRecord
  status: 'running' | 'dry_run'
  idempotencyKey: string
  actorId: string | null
  retryOf?: string | null
}) {
  const { data, error } = await getAdminClient().rpc('claim_automation_run', {
    p_rule_id: input.rule.id,
    p_idempotency_key: input.idempotencyKey,
    p_status: input.status,
    p_actor_id: input.actorId,
    p_retry_of: input.retryOf ?? null,
    p_lease_seconds: 300,
  })
  if (error) throw new Error(error.message)
  return (Array.isArray(data) ? data[0] : data) as ClaimRow | null
}

async function finishRuleRun(input: {
  runId: string
  status: 'dry_run' | 'succeeded' | 'failed' | 'cancelled' | 'skipped'
  proposedCount: number
  executedCount: number
  output: Record<string, unknown>
  proposedActionKeys: string[]
  executedActionKeys: string[]
  error?: unknown
  nextRetryAt?: string | null
}) {
  const { data, error } = await getAdminClient().rpc('finish_automation_run', {
    p_run_id: input.runId,
    p_status: input.status,
    p_proposed_count: input.proposedCount,
    p_executed_count: input.executedCount,
    p_output: input.output,
    p_proposed_action_keys: input.proposedActionKeys,
    p_executed_action_keys: input.executedActionKeys,
    p_error_code: input.error ? 'rule_execution_failed' : null,
    p_error_summary: input.error ? redactOperationalError(input.error) : null,
    p_next_retry_at: input.nextRetryAt ?? null,
  })
  if (error) throw new Error(error.message)
  return data
}

async function loadRule(ruleId: string) {
  const { data, error } = await getAdminClient().from('automation_rules').select('*').eq('id', ruleId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Automation not found')
  if (data.origin === 'system_schedule') throw new Error('System schedules run through their managed endpoint')
  return normalizeRule(data as Record<string, unknown>)
}

export async function dryRunAutomation(ruleId: string, actorId?: string | null) {
  const rule = await loadRule(ruleId)
  const claim = await claimRuleRun({
    rule,
    status: 'dry_run',
    idempotencyKey: `dry-run:${ruleId}:${randomUUID()}`,
    actorId: actorId ?? null,
  })
  if (!claim?.run_id) throw new Error(`Dry run was not claimed: ${claim?.claim_reason ?? 'unknown'}`)
  const candidates = await evaluateAutomationRule(rule)
  const proposed = summarizeAutomationCandidates(candidates)
  const actionKeys = candidates.flatMap(candidate => candidate.actions.map(action => action.actionKey))
  const run = await finishRuleRun({
    runId: claim.run_id,
    status: 'dry_run',
    proposedCount: actionKeys.length,
    executedCount: 0,
    output: { candidates: proposed, candidateCount: candidates.length },
    proposedActionKeys: actionKeys,
    executedActionKeys: [],
  })
  return { run, proposed }
}

async function loadActor(actorId: string | null): Promise<ActionActor> {
  if (!actorId) throw new Error('Enable this rule as an authorized staff user before running it live')
  const { data, error } = await getAdminClient().from('users').select('id, email, role').eq('id', actorId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data || !['admin', 'attorney'].includes(data.role)) throw new Error('Automation actor is not authorized staff')
  return { id: data.id, email: data.email }
}

function numberCondition(conditions: Record<string, unknown>, key: string, fallback: number, min: number, max: number) {
  const value = conditions[key]
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback
}

function nextRuleRun(rule: AutomationRuleRecord, now: Date) {
  const minutes = numberCondition(rule.conditions, 'intervalMinutes', 60, 5, 10080)
  return new Date(now.getTime() + minutes * 60_000).toISOString()
}

export async function runAutomationRule(ruleId: string, options: {
  now?: Date
  retryOf?: string | null
  idempotencyKey?: string
} = {}) {
  const now = options.now ?? new Date()
  const rule = await loadRule(ruleId)
  const actor = await loadActor(rule.updated_by)
  const bucket = now.toISOString().slice(0, 16)
  const claim = await claimRuleRun({
    rule,
    status: 'running',
    idempotencyKey: options.idempotencyKey ?? `rule:${rule.id}:${bucket}`,
    actorId: actor.id,
    retryOf: options.retryOf,
  })
  if (!claim?.run_id) return { skipped: true, reason: claim?.claim_reason ?? 'not_claimed' }
  if (claim.duplicate) return { skipped: true, duplicate: true, reason: claim.claim_reason, runId: claim.run_id }

  let proposedCount = 0
  let executedCount = 0
  const proposedActionKeys: string[] = []
  const executedActionKeys: string[] = []
  try {
    const candidates = await evaluateAutomationRule(rule, now)
    for (const candidate of candidates) {
      for (const action of candidate.actions) {
        const created = await createActionProposal({
          ...action,
          idempotencyKey: `automation:${rule.id}:${action.eventKey}:${action.actionKey}`,
          source: 'automation',
          automationRunId: claim.run_id,
        }, actor)
        proposedCount += 1
        proposedActionKeys.push(action.actionKey)
        if (rule.approval_policy === 'automatic' && created.confirmation.policy !== 'explicit' && created.confirmation.policy !== 'never') {
          const executed = await executeActionProposal(created.proposal.id as string, actor)
          if (executed.execution?.status === 'succeeded') {
            executedCount += 1
            executedActionKeys.push(action.actionKey)
          }
        }
      }
    }
    const proposed = summarizeAutomationCandidates(candidates)
    const run = await finishRuleRun({
      runId: claim.run_id,
      status: 'succeeded',
      proposedCount,
      executedCount,
      output: { candidates: proposed, candidateCount: candidates.length },
      proposedActionKeys,
      executedActionKeys,
    })
    await getAdminClient().from('automation_rules').update({ next_run_at: nextRuleRun(rule, now) }).eq('id', rule.id)
    return { run, proposed, executedCount }
  } catch (error) {
    const { data: currentRun } = await getAdminClient().from('automation_runs').select('attempt').eq('id', claim.run_id).maybeSingle()
    const attempt = currentRun?.attempt ?? 1
    const nextRetryAt = attempt < rule.max_attempts
      ? new Date(now.getTime() + Math.min(24 * 60, 5 * (2 ** Math.max(0, attempt - 1))) * 60_000).toISOString()
      : null
    await finishRuleRun({
      runId: claim.run_id,
      status: 'failed',
      proposedCount,
      executedCount,
      output: { partial: proposedCount > 0 },
      proposedActionKeys,
      executedActionKeys,
      error,
      nextRetryAt,
    })
    if (!nextRetryAt) {
      await getAdminClient().from('automation_rules').update({ mode: 'paused', next_run_at: null }).eq('id', rule.id)
    }
    throw error
  }
}

export async function runDueAutomationRules(now = new Date()) {
  const admin = getAdminClient()
  const { data, error } = await admin.from('automation_rules').select('id')
    .neq('origin', 'system_schedule').eq('mode', 'live').eq('kill_switch', false)
    .or(`next_run_at.is.null,next_run_at.lte.${now.toISOString()}`).limit(20)
  if (error) throw new Error(error.message)
  let succeeded = 0
  let failed = 0
  let skipped = 0
  for (const row of data ?? []) {
    try {
      const { data: retry } = await admin.from('automation_runs')
        .select('id, attempt')
        .eq('rule_id', row.id)
        .eq('status', 'failed')
        .is('retry_requested_at', null)
        .not('next_retry_at', 'is', null)
        .lte('next_retry_at', now.toISOString())
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      const result = await runAutomationRule(row.id, retry ? {
        now,
        retryOf: retry.id,
        idempotencyKey: `retry:${retry.id}:${retry.attempt + 1}`,
      } : { now })
      if (result.skipped) skipped += 1
      else succeeded += 1
    } catch {
      failed += 1
    }
  }
  return { evaluated: (data ?? []).length, succeeded, failed, skipped }
}

export async function retryAutomationRun(runId: string) {
  const admin = getAdminClient()
  const { data: run, error } = await admin.from('automation_runs').select('id, rule_id, status, attempt').eq('id', runId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!run?.rule_id || run.status !== 'failed') throw new Error('Only failed rule runs can be retried')
  const { data: rule } = await admin.from('automation_rules').select('max_attempts, origin').eq('id', run.rule_id).maybeSingle()
  if (!rule || rule.origin === 'system_schedule') throw new Error('System schedules retry at their next expected run')
  if (run.attempt >= rule.max_attempts) throw new Error('This run reached its retry limit')
  return runAutomationRule(run.rule_id, {
    retryOf: runId,
    idempotencyKey: `retry:${runId}:${run.attempt + 1}`,
  })
}
