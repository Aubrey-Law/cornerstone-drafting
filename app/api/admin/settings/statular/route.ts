import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getIntegrationSettings, updateIntegrationSettings } from '@/lib/integrations/settings'
import { getStatularConfigStatus } from '@/lib/integrations/statular/config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Booleans only: the webhook URLs are credentials and never leave the server. */
async function snapshot() {
  const settings = await getIntegrationSettings()
  return { syncEnabled: settings.statularSyncEnabled, config: getStatularConfigStatus() }
}

/** GET /api/admin/settings/statular — webhook readiness and the fit-decision toggle. */
export async function GET(req: Request) {
  const { err } = await requireAdmin(req)
  if (err) return err
  try {
    return NextResponse.json(await snapshot())
  } catch {
    return NextResponse.json({ error: 'Statular settings could not be read' }, { status: 500 })
  }
}

/** PUT /api/admin/settings/statular { syncEnabled } — turn the fit-decision push on or off. */
export async function PUT(req: Request) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const body = await req.json().catch(() => null) as { syncEnabled?: unknown } | null
  if (typeof body?.syncEnabled !== 'boolean') {
    return NextResponse.json({ error: 'syncEnabled must be true or false' }, { status: 400 })
  }

  try {
    await updateIntegrationSettings({ statularSyncEnabled: body.syncEnabled }, userId ?? null)
    return NextResponse.json(await snapshot())
  } catch {
    return NextResponse.json({ error: 'Statular settings could not be saved' }, { status: 500 })
  }
}
