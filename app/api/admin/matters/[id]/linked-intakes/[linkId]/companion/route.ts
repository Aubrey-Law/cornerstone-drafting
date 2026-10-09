import { requireAdminRoute } from '@/lib/forms/http'
import { openCollegePrepCompanionMatter } from '@/lib/forms/collegePrepCompanion'

type Params = { params: Promise<{ id: string; linkId: string }> }

/**
 * POST: open (or return) the hired College Prep matter drafted from this linked
 * questionnaire, so the student's package can be drafted in the usual workspace.
 */
export async function POST(req: Request, { params }: Params) {
  return requireAdminRoute(req, params, ({ id, linkId }, actorId) => openCollegePrepCompanionMatter(id, linkId, actorId))
}
