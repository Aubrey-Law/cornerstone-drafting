import { NextResponse } from 'next/server'
import { requireAdmin, requireAdministrator } from '@/lib/apiAuth'
import { ActionServiceError } from '@/lib/actions/errors'
import { AUTONOMY_LABELS, ACTION_CATALOG_GROUPS, parseActionAutonomy } from '@/lib/actions/autonomy'
import { listDelegationSettings, setActionAutonomy } from '@/lib/actions/delegation'

export const dynamic = 'force-dynamic'

/** The delegation dial: one position per registry action. */
export async function GET(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  try {
    const actions = await listDelegationSettings()
    return NextResponse.json({ actions, levels: AUTONOMY_LABELS, groups: ACTION_CATALOG_GROUPS })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not load delegation settings' }, { status: 500 })
  }
}

/**
 * Moving the dial is a firm-wide grant, so it takes the administrator role
 * rather than any staff login.
 */
export async function PATCH(req: Request) {
  const auth = await requireAdministrator(req)
  if (auth.err || !auth.userId) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as { actionKey?: unknown; autonomy?: unknown }
  const actionKey = typeof body.actionKey === 'string' ? body.actionKey.trim() : ''
  const autonomy = parseActionAutonomy(body.autonomy)
  if (!actionKey || !autonomy) {
    return NextResponse.json({ error: 'actionKey and a valid autonomy level are required' }, { status: 400 })
  }
  try {
    const setting = await setActionAutonomy(actionKey, autonomy, auth.userId)
    return NextResponse.json({ setting })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not update the delegation setting'
    return NextResponse.json(
      { error: message, code: error instanceof ActionServiceError ? error.code : 'update_failed' },
      { status: error instanceof ActionServiceError ? error.status : 500 },
    )
  }
}
