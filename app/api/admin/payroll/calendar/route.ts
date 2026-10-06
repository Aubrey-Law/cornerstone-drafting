import { NextResponse } from 'next/server'
import { requireAdministrator } from '@/lib/apiAuth'
import { firmTodayKey } from '@/lib/firmDate'
import { syncPayrollCalendar } from '@/lib/payroll/calendar'
import { badRequest, payrollFailure, yearParam } from '@/lib/payroll/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST ?year= — put every open, upcoming payroll deadline on the Google Calendar. */
export async function POST(req: Request) {
  const { err } = await requireAdministrator(req)
  if (err) return err
  const year = yearParam(req)
  if (!year) return badRequest('year must be a four-digit year')
  try {
    return NextResponse.json(await syncPayrollCalendar(year, firmTodayKey()))
  } catch (error) {
    return payrollFailure(error, 'Could not sync payroll deadlines to the calendar')
  }
}
