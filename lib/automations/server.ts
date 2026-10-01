import 'server-only'

import { randomUUID } from 'node:crypto'
import { getAdminClient } from '@/lib/supabaseAdmin'
import {
  AUTOMATION_ACTION_KEYS,
  AUTOMATION_TRIGGER_KEYS,
  automationApprovalPolicy,
  type AutomationActionKey,
  type AutomationTriggerKey,
} from '@/lib/automations/registry'

export type AutomationMode = 'dry_run' | 'live' | 'paused'

export interface AutomationRuleInput {
  name: string
  description?: string | null
  triggerKey: AutomationTriggerKey
  actionKey: AutomationActionKey
  conditions?: Record<string, unknown>
  actionConfig?: Record<string, unknown>
  mode?: AutomationMode
  approvalPolicy?: 'automatic' | 'required' | 'prohibited'
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
  const approvalPolicy = safestPolicy === 'required'
    ? 'required'
    : requestedPolicy === 'required' || requestedPolicy === 'prohibited' ? requestedPolicy : 'automatic'
  const mode: AutomationMode = body.mode === 'live' || body.mode === 'paused' ? body.mode : 'dry_run'
  return {
    name,
    description: typeof body.description === 'string' ? body.description.trim().slice(0, 500) || null : null,
    triggerKey: body.triggerKey as AutomationTriggerKey,
    actionKey,
    conditions: body.conditions && typeof body.conditions === 'object' && !Array.isArray(body.conditions)
      ? body.conditions as Record<string, unknown> : {},
    actionConfig: body.actionConfig && typeof body.actionConfig === 'object' && !Array.isArray(body.actionConfig)
      ? body.actionConfig as Record<string, unknown> : {},
    mode,
    approvalPolicy,
  }
}

export async function listAutomationRules() {
  const admin = getAdminClient()
  const { data: rules, error } = await admin.from('automation_rules').select('*').order('name')
  if (error) throw new Error(error.message)
  const ids = (rules ?? []).map(rule => rule.id as string)
  const { data: runs, error: runsError } = ids.length
    ? await admin.from('automation_runs').select('*').in('rule_id', ids).order('started_at', { ascending: false }).limit(500)
    : { data: [], error: null }
  if (runsError) throw new Error(runsError.message)
  const latest = new Map<string, Record<string, unknown>>()
  for (const run of runs ?? []) if (run.rule_id && !latest.has(run.rule_id as string)) latest.set(run.rule_id as string, run as Record<string, unknown>)
  return (rules ?? []).map(rule => ({ ...rule, lastRun: latest.get(rule.id as string) ?? null }))
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
    created_by: actorId,
    updated_by: actorId,
  }).select('*').single()
  if (error) throw new Error(error.message)
  return data
}

export async function dryRunAutomation(ruleId: string) {
  const admin = getAdminClient()
  const { data: rule, error } = await admin.from('automation_rules').select('*').eq('id', ruleId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!rule) throw new Error('Automation not found')
  const proposed = [{
    actionKey: rule.action_key,
    approvalPolicy: rule.approval_policy,
    description: `Would evaluate ${rule.trigger_key} and prepare ${rule.action_key}`,
  }]
  const { data: run, error: runError } = await admin.from('automation_runs').insert({
    rule_id: ruleId,
    status: 'dry_run',
    idempotency_key: `dry-run:${ruleId}:${randomUUID()}`,
    finished_at: new Date().toISOString(),
    proposed_count: proposed.length,
    executed_count: 0,
  }).select('*').single()
  if (runError) throw new Error(runError.message)
  return { run, proposed }
}
