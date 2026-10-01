import { NextResponse } from 'next/server'
import { requireAdministrator } from '@/lib/apiAuth'
import { clearFirmSettingsCache } from '@/lib/firmSettings'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { runWorkGraphReconciliation } from '@/lib/work/rolloutServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(req: Request) {
  const auth = await requireAdministrator(req)
  if (auth.err || !auth.userId) {
    return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => null) as { enabled?: unknown } | null
  if (typeof body?.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 })
  }

  try {
    let readiness = null
    if (body.enabled) {
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

    const { data, error } = await getAdminClient().from('firm_settings').update({
      command_center_v2_enabled: body.enabled,
      command_center_v2_enabled_at: body.enabled ? new Date().toISOString() : null,
      command_center_v2_enabled_by: body.enabled ? auth.userId : null,
    }).eq('id', 1).select('command_center_v2_enabled, command_center_v2_enabled_at').single()
    if (error) throw new Error(error.message)
    clearFirmSettingsCache()
    return NextResponse.json({ settings: data, readiness })
  } catch (error) {
    console.error('command center rollout update failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'The rollout setting could not be changed' },
      { status: 500 },
    )
  }
}
