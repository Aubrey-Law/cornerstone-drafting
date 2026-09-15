import { engagementHttpError, getScopedAgreement, requireEngagementStaff } from '@/lib/engagement/http'
import { resendEngagementRecipients } from '@/lib/engagement/postSend'

type Context = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Context) {
  try {
    await requireEngagementStaff()
    const id = (await params).id
    await getScopedAgreement(id)
    const body = await request.json() as { recipientIds?: unknown; customMessage?: unknown }
    // An explicit recipient list, never "everyone": a resend is an email to a
    // client, and the caller has to say who.
    if (!Array.isArray(body.recipientIds) || body.recipientIds.length === 0
      || !body.recipientIds.every((value): value is string => typeof value === 'string' && value.length > 0)) {
      throw new Error('At least one recipient must be selected')
    }
    return Response.json(await resendEngagementRecipients({
      agreementId: id,
      recipientIds: body.recipientIds,
      ...(typeof body.customMessage === 'string' && body.customMessage.trim()
        ? { customMessage: body.customMessage.trim() }
        : {}),
    }))
  } catch (e) { return engagementHttpError(e) }
}
