import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import {
  MAX_SMS_BODY_LENGTH,
  resolveMatterSmsTarget,
  sendOutboundSms,
} from '@/lib/sms/outbound'
import { isSmsConfigured } from '@/lib/communications/config'

type Params = { params: Promise<{ id: string }> }

function parseRecipient(value: unknown): 'client' | 'spouse' | null {
  if (value === 'client' || value === 'spouse') return value
  return null
}

export async function POST(req: NextRequest, { params }: Params) {
  const { err, userId, user } = await requireAdmin(req)
  if (err) return err

  if (!isSmsConfigured()) {
    return NextResponse.json(
      { error: 'The selected SMS provider is not configured.' },
      { status: 503 },
    )
  }

  const { id: matterId } = await params

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const recipient = parseRecipient(body.recipient)
  if (!recipient) {
    return NextResponse.json({ error: 'recipient must be client or spouse' }, { status: 400 })
  }

  const messageBody = typeof body.body === 'string' ? body.body.trim() : ''
  if (!messageBody) {
    return NextResponse.json({ error: 'body is required' }, { status: 400 })
  }
  if (messageBody.length > MAX_SMS_BODY_LENGTH) {
    return NextResponse.json(
      { error: `body must be ${MAX_SMS_BODY_LENGTH} characters or fewer` },
      { status: 400 },
    )
  }

  const { target, error: resolveError } = await resolveMatterSmsTarget(matterId, recipient)
  if (resolveError) {
    const status = resolveError === 'Matter not found' ? 404 : 500
    return NextResponse.json({ error: resolveError }, { status })
  }
  if (!target) {
    return NextResponse.json({ error: 'Could not resolve SMS recipient' }, { status: 400 })
  }

  const actorName =
    (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? null

  const result = await sendOutboundSms(target, messageBody, {
    id: userId!,
    email: user?.email ?? null,
    name: actorName,
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
