import { NextResponse } from 'next/server'
import { requireAdministrator } from '@/lib/apiAuth'
import { badRequest, payrollFailure } from '@/lib/payroll/http'
import { renderPayStub } from '@/lib/payroll/payStub'
import { getRun, loadPayrollYear } from '@/lib/payroll/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }

/** GET — the pay stub PDF for one run. */
export async function GET(req: Request, { params }: Context) {
  const { err } = await requireAdministrator(req)
  if (err) return err
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return badRequest('Invalid run id')
  try {
    const run = await getRun(id)
    if (!run) return NextResponse.json({ error: 'Payroll run not found' }, { status: 404 })
    const { settings, register } = await loadPayrollYear(run.taxYear)
    const pdf = await renderPayStub(settings, register, id)
    return new Response(Buffer.from(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="pay-stub-${run.payDate}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    return payrollFailure(error, 'Could not build the pay stub')
  }
}
