import { engagementHttpError, getScopedAgreement, requireEngagementStaff } from '@/lib/engagement/http'
import { cancelEngagementRequest } from '@/lib/engagement/postSend'

type Context = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Context) {
  try {
    await requireEngagementStaff()
    const id = (await params).id
    await getScopedAgreement(id)
    const body = await request.json() as { reason?: unknown; confirm?: unknown }
    // Cancelling withdraws a live agreement from a client who may be mid-
    // signature, so it takes an explicit confirmation and a stated reason.
    if (body.confirm !== true) throw new Error('Cancellation must be confirmed')
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (!reason) throw new Error('A cancellation reason is required')
    return Response.json(await cancelEngagementRequest({ agreementId: id, reason }))
  } catch (e) { return engagementHttpError(e) }
}
