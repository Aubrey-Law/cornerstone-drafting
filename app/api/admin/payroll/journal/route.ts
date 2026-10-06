import { NextResponse } from 'next/server'
import { requireAdministrator } from '@/lib/apiAuth'
import { badRequest, payrollFailure, yearParam } from '@/lib/payroll/http'
import { toJournalCsv } from '@/lib/payroll/journal'
import { journalEntries } from '@/lib/payroll/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET ?year=&quarter=&run=&format=csv|json — payroll journal entries for the
 * books (Mercury Accounting): each payroll, plus recorded deposits and
 * remittances. CSV by default.
 */
export async function GET(req: Request) {
  const { err } = await requireAdministrator(req)
  if (err) return err
  const url = new URL(req.url)
  const year = yearParam(req)
  if (!year) return badRequest('year must be a four-digit year')
  const quarterRaw = url.searchParams.get('quarter')
  const quarter = quarterRaw ? Number(quarterRaw) : undefined
  if (quarter !== undefined && ![1, 2, 3, 4].includes(quarter)) return badRequest('quarter must be 1 to 4')
  const runId = url.searchParams.get('run') ?? undefined
  if (runId && !/^[0-9a-f-]{36}$/i.test(runId)) return badRequest('Invalid run id')
  try {
    const entries = await journalEntries(year, { quarter: quarter as 1 | 2 | 3 | 4 | undefined, runId })
    if (url.searchParams.get('format') === 'json') return NextResponse.json({ entries })
    const label = runId ? `run-${runId.slice(0, 8)}` : quarter ? `${year}-Q${quarter}` : String(year)
    return new Response(toJournalCsv(entries), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="payroll-journal-${label}.csv"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    return payrollFailure(error, 'Could not build the payroll journal')
  }
}
