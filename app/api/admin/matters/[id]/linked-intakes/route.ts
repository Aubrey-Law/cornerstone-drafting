import { z } from 'zod'
import { requireAdminRoute } from '@/lib/forms/http'
import { addLinkedIntake } from '@/lib/forms/matterForms'

type Params = { params: Promise<{ id: string }> }

const addSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().max(100).default(''),
  email: z.string().trim().email().max(320),
  track: z.enum(['estate', 'college_prep']),
  label: z.string().trim().max(160).nullish().transform(value => value || null),
}).strict()

/** POST: add another person's questionnaire (e.g. a student's College Prep) to this matter. */
export async function POST(req: Request, { params }: Params) {
  return requireAdminRoute(req, params, async ({ id }, actorId) => {
    const input = addSchema.parse(await req.json().catch(() => null))
    return { intake: await addLinkedIntake(id, actorId, input) }
  })
}
