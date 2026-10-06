import { NextResponse } from 'next/server'
import { requireAdministrator } from '@/lib/apiAuth'
import { CHECKLIST_SCOPES, type ChecklistScope } from '@/lib/payroll/checklists'
import { badRequest, payrollFailure, readJson, yearParam } from '@/lib/payroll/http'
import { listChecklist, setChecklistItem } from '@/lib/payroll/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET ?year= — the ticked checklist items. */
export async function GET(req: Request) {
  const { err } = await requireAdministrator(req)
  if (err) return err
  const year = yearParam(req)
  if (!year) return badRequest('year must be a four-digit year')
  try {
    return NextResponse.json({ items: await listChecklist(year) })
  } catch (error) {
    return payrollFailure(error, 'Could not load the payroll checklists')
  }
}

/** PATCH ?year= { scope, itemKey, periodRef?, done } — tick or untick an item. */
export async function PATCH(req: Request) {
  const { err } = await requireAdministrator(req)
  if (err) return err
  const year = yearParam(req)
  if (!year) return badRequest('year must be a four-digit year')
  const body = await readJson(req)
  if (!body) return badRequest('Expected a JSON object')
  if (!CHECKLIST_SCOPES.includes(body.scope as ChecklistScope)) return badRequest('Unknown checklist scope')
  if (typeof body.itemKey !== 'string' || typeof body.done !== 'boolean') return badRequest('itemKey and done are required')
  const periodRef = typeof body.periodRef === 'string' ? body.periodRef.slice(0, 64) : ''
  try {
    await setChecklistItem(year, { scope: body.scope as ChecklistScope, itemKey: body.itemKey, periodRef, done: body.done })
    return NextResponse.json({ items: await listChecklist(year) })
  } catch (error) {
    return payrollFailure(error, 'Could not update the checklist')
  }
}
