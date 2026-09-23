import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { isSmsConfigured } from '@/lib/communications/config'
import { MAX_LEAD_SMS_BODY_LENGTH } from '@/lib/sms/constants'
import { resolveLeadSmsTarget, sendOutboundSms } from '@/lib/sms/outbound'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const { err, userId, user } = await requireAdmin(req)
  if (err) return err
  if (!isSmsConfigured()) {
    return NextResponse.json(
      { error: 'The selected SMS provider is not configured.' },
      { status: 503 },
    )
  }

  const { id } = await params
  const payload = (await req.json().catch(() => null)) as { body?: unknown } | null
  const message = typeof payload?.body === 'string' ? payload.body.trim() : ''
  if (!message) return NextResponse.json({ error: 'Message is required' }, { status: 400 })
  if (message.length > MAX_LEAD_SMS_BODY_LENGTH) {
    return NextResponse.json(
      { error: `Message must be ${MAX_LEAD_SMS_BODY_LENGTH} characters or fewer` },
      { status: 400 },
    )
  }

  const { target, error } = await resolveLeadSmsTarget(id, { includeLinkedMatter: true })
  if (error) {
    return NextResponse.json({ error }, { status: error === 'Lead not found' ? 404 : 500 })
  }
  if (!target) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

  const result = await sendOutboundSms(target, message, {
    id: userId!,
    email: user?.email ?? null,
    name: (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? null,
  })

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        smsMessage: result.smsMessage ?? null,
        activity: result.activity ?? null,
      },
      { status: result.status ?? 502 },
    )
  }

  return NextResponse.json({
    success: true,
    status: result.status,
    providerMessageId: result.providerMessageId,
    smsMessage: result.smsMessage,
    activity: result.activity,
  })
}
