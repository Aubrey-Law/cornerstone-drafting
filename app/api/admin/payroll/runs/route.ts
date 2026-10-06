import { NextResponse } from 'next/server'
import { requireAdministrator } from '@/lib/apiAuth'
import { badRequest, centsField, dateField, FieldError, payrollFailure, readJson, textField, yearParam } from '@/lib/payroll/http'
import { createRun, loadPayrollYear } from '@/lib/payroll/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET ?year= — settings, runs, the computed register and the quarterly summary. */
export async function GET(req: Request) {
  const { err } = await requireAdministrator(req)
  if (err) return err
  const year = yearParam(req)
  if (!year) return badRequest('year must be a four-digit year')
  try {
    return NextResponse.json(await loadPayrollYear(year))
  } catch (error) {
    return payrollFailure(error, 'Could not load payroll')
  }
}

/** POST { payDate, grossCents, fedWhOverrideCents?, notes? } — add a pay date. */
export async function POST(req: Request) {
  const { err } = await requireAdministrator(req)
  if (err) return err
  const body = await readJson(req)
  if (!body) return badRequest('Expected a JSON object')
  try {
    const payDate = dateField(body, 'payDate', { nullable: false })
    const grossCents = centsField(body, 'grossCents', { positive: true })
    if (!payDate) return badRequest('payDate is required')
    if (grossCents == null) return badRequest('grossCents is required')
    const run = await createRun({
      payDate,
      grossCents,
      fedWhOverrideCents: centsField(body, 'fedWhOverrideCents', { nullable: true }) ?? null,
      notes: textField(body, 'notes') ?? null,
    })
    return NextResponse.json({ run }, { status: 201 })
  } catch (error) {
    if (error instanceof FieldError) return badRequest(error.message)
    return payrollFailure(error, 'Could not add the payroll run')
  }
}
