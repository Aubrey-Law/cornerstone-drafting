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
type Context = { params: Promise<{ templateId: string }> }
const paramsSchema = z.object({ templateId: z.string().uuid() })
const publishSchema = z.object({
  versionId: z.string().uuid(),
  expectedLockVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  expectedDefinitionHash: z.string().regex(/^[0-9a-f]{64}$/),
}).strict()

export async function POST(req: Request, context: Context) {
  const { err, userId } = await requireAdministrator(req)
  if (err) return err
  try {
    const route = paramsSchema.safeParse(await context.params)
    if (!route.success) return badRequest()
    const body = publishSchema.safeParse(await req.json().catch(() => null))
    if (!body.success) return badRequest()
    const result = await service.publishIntakeFormTemplateDraft({ templateId: route.data.templateId, ...body.data, actorId: userId! })
    return NextResponse.json({ version: result })
  } catch (error) { return failure(error) }
}
