import { requireAdminRoute } from '@/lib/forms/http'
import { removeLinkedIntake } from '@/lib/forms/matterForms'

type Params = { params: Promise<{ id: string; linkId: string }> }

/** DELETE: take a linked questionnaire off the matter (answers already given are kept). */
export async function DELETE(req: Request, { params }: Params) {
  return requireAdminRoute(req, params, ({ id, linkId }, actorId) => removeLinkedIntake(id, linkId, actorId))
}
