import { z } from 'zod'
import { requireAdminRoute } from '@/lib/forms/http'
import { getClientFormForStaff, resendClientForm, updateClientFormStatus } from '@/lib/forms/matterForms'

type Params = { params: Promise<{ id: string; assignmentId: string }> }

/** GET: a sent form with its pinned definition and the client's answers. */
export async function GET(req: Request, { params }: Params) {
  return requireAdminRoute(req, params, ({ id, assignmentId }) => getClientFormForStaff(id, assignmentId))
}

const actionSchema = z.object({ action: z.enum(['resend', 'cancel', 'reopen']) }).strict()

/** PATCH: resend the email, withdraw an unsubmitted form, or reopen a submitted one. */
export async function PATCH(req: Request, { params }: Params) {
  return requireAdminRoute(req, params, async ({ id, assignmentId }, actorId) => {
    const { action } = actionSchema.parse(await req.json().catch(() => null))
    if (action === 'resend') return resendClientForm(id, assignmentId, actorId)
    return { assignment: await updateClientFormStatus(id, assignmentId, actorId, action) }
  })
}
