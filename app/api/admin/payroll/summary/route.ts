import { NextResponse } from 'next/server'
import { requireAdministrator } from '@/lib/apiAuth'
import { badRequest, payrollFailure, yearParam } from '@/lib/payroll/http'
import { loadPayrollYear } from '@/lib/payroll/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET ?year= — quarterly figures for 941 / DUA / PFML and the W-2 tie-out. */
export async function GET(req: Request) {
  const { err } = await requireAdministrator(req)
  if (err) return err
  const year = yearParam(req)
  if (!year) return badRequest('year must be a four-digit year')
  try {
    const { summary } = await loadPayrollYear(year)
    return NextResponse.json({ summary })
  } catch (error) {
    return payrollFailure(error, 'Could not load the payroll summary')
  }
}
