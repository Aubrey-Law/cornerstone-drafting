import { z } from 'zod'
import { requireAdmin } from '@/lib/apiAuth'
import { MatterFormsError } from './matterForms'

const uuid = z.string().uuid()

export function formsErrorResponse(error: unknown, fallback = 'Forms are temporarily unavailable.'): Response {
  if (error instanceof z.ZodError) return Response.json({ error: 'Check the highlighted fields.', fieldErrors: error.flatten().fieldErrors }, { status: 422 })
  if (error instanceof MatterFormsError) return Response.json({ error: error.message }, { status: error.status })
  console.error('[forms route]', error)
  return Response.json({ error: fallback }, { status: 500 })
}

/** Staff route wrapper: auth, uuid params, consistent errors, never cached. */
export async function requireAdminRoute<P extends Record<string, string>>(
  req: Request,
  params: Promise<P>,
  run: (ids: P, actorId: string) => Promise<unknown>,
): Promise<Response> {
  const { err, userId } = await requireAdmin(req)
  if (err) return err
  try {
    const ids = await params
    for (const value of Object.values(ids)) uuid.parse(value)
    return Response.json(await run(ids, userId!), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return formsErrorResponse(error)
  }
}
