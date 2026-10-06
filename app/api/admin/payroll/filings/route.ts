import { NextResponse } from 'next/server'
import { requireAdministrator } from '@/lib/apiAuth'
import { badRequest, dateField, FieldError, payrollFailure, readJson, textField, yearParam } from '@/lib/payroll/http'
import { listFilings, updateFiling } from '@/lib/payroll/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET ?year= — every filing and deposit deadline for the year, with done state. */
export async function GET(req: Request) {
  const { err } = await requireAdministrator(req)
  if (err) return err
  const year = yearParam(req)
  if (!year) return badRequest('year must be a four-digit year')
  try {
    return NextResponse.json({ filings: await listFilings(year) })
  } catch (error) {
    return payrollFailure(error, 'Could not load payroll deadlines')
  }
}

/** PATCH ?year= { key, doneOn?, confirmation?, notes?, dueDate? } — record a filing. */
export async function PATCH(req: Request) {
  const { err } = await requireAdministrator(req)
  if (err) return err
  const year = yearParam(req)
  if (!year) return badRequest('year must be a four-digit year')
  const body = await readJson(req)
  if (!body || typeof body.key !== 'string') return badRequest('key is required')
  if (body.key.startsWith('fed-deposit:')) return badRequest('Record federal deposits on the payroll run')
  try {
    await updateFiling(year, body.key, {
      doneOn: dateField(body, 'doneOn'),
      confirmation: textField(body, 'confirmation', 64),
      notes: textField(body, 'notes', 2000),
      dueDate: dateField(body, 'dueDate', { nullable: false }) ?? undefined,
    })
    return NextResponse.json({ filings: await listFilings(year) })
  } catch (error) {
    if (error instanceof FieldError) return badRequest(error.message)
    return payrollFailure(error, 'Could not update the filing')
  }
}
