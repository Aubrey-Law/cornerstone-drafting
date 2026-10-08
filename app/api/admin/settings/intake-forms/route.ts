import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdministrator } from '@/lib/apiAuth'
import * as service from '@/lib/intake/forms/adminService'

export const runtime = 'nodejs'

const badRequest = () => NextResponse.json({ error: 'Invalid intake form request', code: 'INTAKE_FORM_BAD_REQUEST' }, { status: 400 })
function failure(error: unknown) {
  if (error instanceof service.IntakeFormNotFoundError) {
    return NextResponse.json({ error: 'Intake form resource not found', code: error.code }, { status: 404 })
  }
  if (error instanceof service.IntakeFormConflictError) {
    const message = error.message === 'Definition changed; refresh and try again'
      ? error.message : 'Draft changed; refresh and try again'
    return NextResponse.json({ error: message, code: error.code }, { status: 409 })
  }
  if (error instanceof service.IntakeFormValidationError) {
    return NextResponse.json({ error: 'Invalid intake form request', code: error.code, diagnostics: error.diagnostics }, { status: 422 })
  }
  return NextResponse.json({ error: 'Unable to process intake form request', code: 'INTAKE_FORM_INTERNAL' }, { status: 500 })
}
const createSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/),
  name: z.string().trim().min(1).max(160),
  description: z.string().max(600).nullable().optional(),
  definition: z.record(z.unknown()),
}).strict()

export async function GET(req: Request) {
  const { err } = await requireAdministrator(req)
  if (err) return err
  try {
    const result = await service.listIntakeFormTemplates()
    return NextResponse.json({ templates: result })
  } catch (error) { return failure(error) }
}

export async function POST(req: Request) {
  const { err, userId } = await requireAdministrator(req)
  if (err) return err
  try {
    const body = createSchema.safeParse(await req.json().catch(() => null))
    if (!body.success) return badRequest()
    const result = await service.createIntakeFormTemplate({ ...body.data, actorId: userId! })
    return NextResponse.json(result, { status: 201 })
  } catch (error) { return failure(error) }
}
