import { z } from 'zod'
import { requireAdminRoute } from '@/lib/forms/http'
import { getMatterFormsOverview, sendClientForm } from '@/lib/forms/matterForms'

type Params = { params: Promise<{ id: string }> }

/** GET: the matter's questionnaires, sent client forms, and forms available to send. */
export async function GET(req: Request, { params }: Params) {
  return requireAdminRoute(req, params, ({ id }) => getMatterFormsOverview(id))
}

const sendSchema = z.object({ templateId: z.string().uuid(), recipientIntakeId: z.string().uuid() }).strict()

/** POST: send a published client form to someone on the matter. */
export async function POST(req: Request, { params }: Params) {
  return requireAdminRoute(req, params, async ({ id }, actorId) => {
    const input = sendSchema.parse(await req.json().catch(() => null))
    return sendClientForm(id, actorId, input)
  })
}
