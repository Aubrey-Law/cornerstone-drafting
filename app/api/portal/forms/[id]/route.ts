import { z } from 'zod'
import { getBearerUser } from '@/lib/apiAuth'
import { formsErrorResponse } from '@/lib/forms/http'
import { getPortalClientForm, savePortalClientForm } from '@/lib/forms/portalForms'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * /api/portal/forms/[id] — one client form sent to the signed-in client.
 * Ownership is resolved from the session inside lib/forms/portalForms; the id
 * in the path only selects among forms the caller already owns.
 */
async function authorized(req: Request, params: Params['params']) {
  const user = await getBearerUser(req)
  if (!user) return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { id } = await params
  if (!z.string().uuid().safeParse(id).success) return { error: Response.json({ error: 'Form not found.' }, { status: 404 }) }
  return { user, id }
}

export async function GET(req: Request, { params }: Params) {
  const auth = await authorized(req, params)
  if ('error' in auth) return auth.error
  try {
    return Response.json(await getPortalClientForm(auth.user.id, auth.id), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return formsErrorResponse(error)
  }
}

const saveSchema = z.object({
  revision: z.number().int().nonnegative(),
  answers: z.record(z.union([z.string(), z.array(z.string()), z.null()])),
  submit: z.boolean().default(false),
}).strict()

export async function PUT(req: Request, { params }: Params) {
  const auth = await authorized(req, params)
  if ('error' in auth) return auth.error
  try {
    const input = saveSchema.parse(await req.json().catch(() => null))
    const result = await savePortalClientForm(auth.user.id, auth.id, input)
    if (!result.ok) return Response.json({ error: 'Please answer the highlighted questions.', issues: result.issues }, { status: 422 })
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return formsErrorResponse(error, 'Could not save your answers. Please try again.')
  }
}
