import { engagementHttpError, getScopedAgreement, requireEngagementStaff } from '@/lib/engagement/http'
import { getEngagementStatus, refreshEngagementStatus } from '@/lib/engagement/postSend'

type Context = { params: Promise<{ id: string }> }

/** GET reads stored state; POST re-checks the provider first. */
export async function GET(_request: Request, { params }: Context) {
  try {
    await requireEngagementStaff()
    const id = (await params).id
    await getScopedAgreement(id)
    return Response.json(await getEngagementStatus(id))
  } catch (e) { return engagementHttpError(e) }
}

export async function POST(_request: Request, { params }: Context) {
  try {
    await requireEngagementStaff()
    const id = (await params).id
    await getScopedAgreement(id)
    return Response.json(await refreshEngagementStatus(id))
  } catch (e) { return engagementHttpError(e) }
}
