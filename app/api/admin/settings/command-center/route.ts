import { NextResponse } from 'next/server'
import { requireAdministrator } from '@/lib/apiAuth'
import { clearFirmSettingsCache } from '@/lib/firmSettings'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { calculateCommandCenterCutoverReadiness } from '@/lib/work/cutover'
import { listWorkGraphReconciliationRuns, runWorkGraphReconciliation } from '@/lib/work/rolloutServer'
import { listCommandCenterUsage } from '@/lib/work/usageServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(req: Request) {
  const auth = await requireAdministrator(req)
  if (auth.err || !auth.userId) {
    return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => null) as { action?: unknown; enabled?: unknown } | null
  const action = body?.action === 'enable_parallel' || body?.action === 'cutover' || body?.action === 'rollback'
    ? body.action
    : typeof body?.enabled === 'boolean'
      ? body.enabled ? 'enable_parallel' : 'rollback'
      : null
  if (!action) return NextResponse.json({ error: 'A valid rollout action is required' }, { status: 400 })

  try {
    const admin = getAdminClient()
    const { data: current, error: currentError } = await admin.from('firm_settings')
      .select('command_center_v2_enabled, command_center_v2_enabled_at, command_center_cutover_at')
      .eq('id', 1)
      .single()
    if (currentError) throw new Error(currentError.message)
    if (action === 'cutover' && current.command_center_cutover_at) {
      return NextResponse.json({ settings: current, readiness: null, cutoverReadiness: null })
    }
    if (action === 'enable_parallel' && current.command_center_cutover_at) {
      return NextResponse.json({
        error: 'Use emergency rollback before starting a new parallel run.',
      }, { status: 409 })
    }

    let readiness = null
    let cutoverReadiness = null
    if (action === 'enable_parallel' || action === 'cutover') {
      const result = await runWorkGraphReconciliation({ userId: auth.userId, trigger: 'activation' })
      readiness = result.readiness
      if (!readiness.ready) {
        return NextResponse.json({
          error: 'The command center has not passed its rollout gate.',
          readiness,
          reconciliation: result.reconciliation,
        }, { status: 409 })
      }
    }

    if (action === 'cutover') {
      const [runs, usage] = await Promise.all([
        listWorkGraphReconciliationRuns(auth.userId, 100),
        listCommandCenterUsage(auth.userId),
      ])
      cutoverReadiness = calculateCommandCenterCutoverReadiness({
        enabledAt: current.command_center_v2_enabled_at,
        cutoverAt: current.command_center_cutover_at,
        runs,
        usage,
      })
      if (!current.command_center_v2_enabled || !cutoverReadiness.ready) {
        return NextResponse.json({
          error: 'The ten-business-day cutover gate has not passed.',
          readiness,
          cutoverReadiness,
        }, { status: 409 })
      }
    }

    const now = new Date().toISOString()
    const patch = action === 'rollback'
      ? {
          command_center_v2_enabled: false,
          command_center_v2_enabled_at: null,
          command_center_v2_enabled_by: null,
          command_center_cutover_at: null,
          command_center_cutover_by: null,
        }
      : action === 'cutover'
        ? {
            command_center_v2_enabled: true,
            command_center_cutover_at: now,
            command_center_cutover_by: auth.userId,
          }
        : {
            command_center_v2_enabled: true,
            command_center_v2_enabled_at: current.command_center_v2_enabled_at ?? now,
            command_center_v2_enabled_by: auth.userId,
            command_center_cutover_at: null,
            command_center_cutover_by: null,
          }
    const { data, error } = await admin.from('firm_settings').update(patch)
      .eq('id', 1)
      .select('command_center_v2_enabled, command_center_v2_enabled_at, command_center_cutover_at')
      .single()
    if (error) throw new Error(error.message)
    clearFirmSettingsCache()
    return NextResponse.json({ settings: data, readiness, cutoverReadiness })
  } catch (error) {
    console.error('command center rollout update failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'The rollout setting could not be changed' },
      { status: 500 },
    )
  }
}
