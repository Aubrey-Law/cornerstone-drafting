import { NextResponse } from 'next/server'
import { requireAdministrator } from '@/lib/apiAuth'
import { badRequest, centsField, dateField, FieldError, payrollFailure, readJson, textField } from '@/lib/payroll/http'
import { deleteRun, updateRun, type RunPatch } from '@/lib/payroll/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** PATCH — edit a draft's inputs, record deposits, or finalize / un-finalize. */
export async function PATCH(req: Request, { params }: Context) {
  const { err } = await requireAdministrator(req)
  if (err) return err
  const { id } = await params
  if (!UUID.test(id)) return badRequest('Invalid run id')
  const body = await readJson(req)
  if (!body) return badRequest('Expected a JSON object')
  try {
    const patch: RunPatch = {}
    const payDate = dateField(body, 'payDate', { nullable: false })
    if (payDate) patch.payDate = payDate
    const gross = centsField(body, 'grossCents', { positive: true })
    if (gross != null) patch.grossCents = gross
    const override = centsField(body, 'fedWhOverrideCents', { nullable: true })
    if (override !== undefined) patch.fedWhOverrideCents = override
    if ('status' in body) {
      if (body.status !== 'draft' && body.status !== 'finalized') return badRequest('status must be draft or finalized')
      patch.status = body.status
    }
    for (const key of ['netPaidOn', 'fedDepositPaidOn', 'maDepositPaidOn'] as const) {
      const value = dateField(body, key)
      if (value !== undefined) patch[key] = value
    }
    const confirmation = textField(body, 'eftpsConfirmation', 64)
    if (confirmation !== undefined) patch.eftpsConfirmation = confirmation
    const notes = textField(body, 'notes', 2000)
    if (notes !== undefined) patch.notes = notes
    return NextResponse.json({ run: await updateRun(id, patch) })
  } catch (error) {
    if (error instanceof FieldError) return badRequest(error.message)
    return payrollFailure(error, 'Could not update the payroll run')
  }
}

/** DELETE — remove a draft run. A finalized run must be un-finalized first. */
export async function DELETE(req: Request, { params }: Context) {
  const { err } = await requireAdministrator(req)
  if (err) return err
  const { id } = await params
  if (!UUID.test(id)) return badRequest('Invalid run id')
  try {
    await deleteRun(id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return payrollFailure(error, 'Could not delete the payroll run')
  }
}
