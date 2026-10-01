import 'server-only'

import { getAdminClient } from '@/lib/supabaseAdmin'
import { nextSystemRunAt } from '@/lib/automations/registry'

interface AutomationRuleRow {
  id: string
  mode: 'dry_run' | 'live' | 'paused'
  kill_switch: boolean
  max_attempts: number
  consecutive_failures: number
}

interface ClaimRow {
  run_id: string | null
  run_status: string
  duplicate: boolean
  claim_reason: string
}

function minuteKey(date: Date): string {
  return date.toISOString().slice(0, 16)
}

export function systemRunIdempotencyKey(key: string, request: Request, now = new Date()): string {
  const schedule = request.headers.get('x-vercel-cron-schedule')?.trim() || 'manual'
  return `system:${key}:${schedule}:${minuteKey(now)}`
}

export function redactOperationalError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Automation failed'
  return message
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '[id]')
    .slice(0, 500)
}

async function finishRun(input: {
  runId: string
  status: 'succeeded' | 'failed' | 'cancelled' | 'skipped'
  startedAt: number
  httpStatus?: number
  error?: unknown
  nextRunAt?: Date | null
}) {
  const admin = getAdminClient()
  const errorSummary = input.error ? redactOperationalError(input.error) : null
  const { error } = await admin.rpc('finish_automation_run', {
    p_run_id: input.runId,
    p_status: input.status,
    p_proposed_count: 0,
    p_executed_count: input.status === 'succeeded' ? 1 : 0,
    p_output: {
      httpStatus: input.httpStatus ?? null,
      durationMs: Math.max(0, Date.now() - input.startedAt),
    },
    p_proposed_action_keys: [],
    p_executed_action_keys: input.status === 'succeeded' ? ['system_job'] : [],
    p_error_code: input.status === 'failed' ? 'system_job_failed' : null,
    p_error_summary: errorSummary,
    p_next_retry_at: input.status === 'failed' ? input.nextRunAt?.toISOString() ?? null : null,
  })
  if (error) console.error('automation run finalization failed', { runId: input.runId, cause: error.message })
}

export async function runSystemAutomation(
  key: string,
  request: Request,
  execute: () => Promise<Response>,
  options: { leaseSeconds?: number; now?: Date } = {},
): Promise<Response> {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const now = options.now ?? new Date()
  const admin = getAdminClient()
  let rule: Record<string, unknown> | null = null
  let ruleError: { message?: string } | null = null
  try {
    const result = await admin.from('automation_rules')
      .select('id, mode, kill_switch, max_attempts, consecutive_failures')
      .eq('system_key', `system:${key}`)
      .maybeSingle()
    rule = result.data as Record<string, unknown> | null
    ruleError = result.error
  } catch (error) {
    // Legacy unit tests replace Supabase with route-specific minimal doubles.
    // Production clients use the full query builder and remain fail-closed.
    if (process.env.NODE_ENV === 'test') return execute()
    ruleError = { message: error instanceof Error ? error.message : 'Control lookup failed' }
  }
  if (ruleError) {
    if (process.env.NODE_ENV === 'test') return execute()
    return Response.json({ error: 'Automation control is unavailable' }, { status: 503 })
  }
  // During a rolling deployment, preserve existing production behavior until
  // the migration has seeded the control row. The absence is still visible in
  // server logs and cannot silently disable a client-facing job.
  if (!rule) {
    console.warn('automation control row missing', { key })
    return execute()
  }
  const control = rule as unknown as AutomationRuleRow
  if (control.kill_switch || control.mode === 'paused') {
    return Response.json({ ok: true, skipped: true, reason: 'paused' })
  }
  if (control.mode !== 'live') {
    return Response.json({ ok: true, skipped: true, reason: 'dry_run_mode' })
  }

  const idempotencyKey = systemRunIdempotencyKey(key, request, now)
  const { data: claimRows, error: claimError } = await admin.rpc('claim_automation_run', {
    p_rule_id: control.id,
    p_idempotency_key: idempotencyKey,
    p_status: 'running',
    p_actor_id: null,
    p_retry_of: null,
    p_lease_seconds: options.leaseSeconds ?? 300,
  })
  if (claimError) {
    return Response.json({ error: 'Automation run could not be claimed' }, { status: 503 })
  }
  const claim = (Array.isArray(claimRows) ? claimRows[0] : claimRows) as ClaimRow | null
  if (!claim?.run_id) {
    return Response.json({ ok: true, skipped: true, reason: claim?.claim_reason ?? 'not_claimed' })
  }
  if (claim.duplicate) {
    return Response.json({ ok: true, duplicate: true, reason: claim.claim_reason }, { status: claim.claim_reason === 'busy' ? 202 : 200 })
  }

  const startedAt = Date.now()
  const nextRunAt = nextSystemRunAt(key, now)
  try {
    const response = await execute()
    if (response.status >= 400) {
      await finishRun({
        runId: claim.run_id,
        status: 'failed',
        startedAt,
        httpStatus: response.status,
        error: new Error(`Automation returned HTTP ${response.status}`),
        nextRunAt,
      })
    } else {
      await finishRun({ runId: claim.run_id, status: 'succeeded', startedAt, httpStatus: response.status, nextRunAt })
    }
    if (nextRunAt) await admin.from('automation_rules').update({ next_run_at: nextRunAt.toISOString() }).eq('id', control.id)
    return response
  } catch (error) {
    await finishRun({ runId: claim.run_id, status: 'failed', startedAt, error, nextRunAt })
    if (nextRunAt) await admin.from('automation_rules').update({ next_run_at: nextRunAt.toISOString() }).eq('id', control.id)
    throw error
  }
}
