import { NextResponse } from 'next/server'
import { requireAdministrator } from '@/lib/apiAuth'
import { badRequest, payrollFailure, readJson, yearParam } from '@/lib/payroll/http'
import { mergeSettings } from '@/lib/payroll/settingsInput'
import { loadSettings, saveSettings } from '@/lib/payroll/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET ?year= — the year's settings (defaults, unsaved, when there are none). */
export async function GET(req: Request) {
  const { err } = await requireAdministrator(req)
  if (err) return err
  const year = yearParam(req)
  if (!year) return badRequest('year must be a four-digit year')
  try {
    const { settings, stored } = await loadSettings(year)
    return NextResponse.json({ settings, stored })
  } catch (error) {
    return payrollFailure(error, 'Could not load payroll settings')
  }
}

/** PUT ?year= — save the year's settings and recompute every draft run. */
export async function PUT(req: Request) {
  const { err } = await requireAdministrator(req)
  if (err) return err
  const year = yearParam(req)
  if (!year) return badRequest('year must be a four-digit year')
  const body = await readJson(req)
  if (!body) return badRequest('Expected a JSON object')
  try {
    const { settings } = await loadSettings(year)
    const merged = mergeSettings(settings, body)
    if (typeof merged === 'string') return badRequest(merged)
    return NextResponse.json({ settings: await saveSettings({ ...merged, taxYear: year }), stored: true })
  } catch (error) {
    return payrollFailure(error, 'Could not save payroll settings')
  }
}
