import { NextResponse } from 'next/server'
import { requireAdmin, requireAdministrator } from '@/lib/apiAuth'
import { parseSettingsPatch } from '@/lib/fileClosing/model'
import { fileClosingOverview, updateFileClosingSettings } from '@/lib/fileClosing/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET — the retention settings and where every closed file stands. */
export async function GET(req: Request) {
  const { err } = await requireAdmin(req)
  if (err) return err
  try {
    const overview = await fileClosingOverview()
    return NextResponse.json(overview)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not load file closing settings' }, { status: 500 })
  }
}

/** PATCH — change the retention period or the closing notice. Administrators only. */
export async function PATCH(req: Request) {
  const auth = await requireAdministrator(req)
  if (auth.err) return auth.err
  const body = await req.json().catch(() => null)
  let patch
  try {
    patch = parseSettingsPatch(body)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid settings' }, { status: 400 })
  }
  try {
    const settings = await updateFileClosingSettings(patch)
    return NextResponse.json({ settings })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not save file closing settings' }, { status: 500 })
  }
}
