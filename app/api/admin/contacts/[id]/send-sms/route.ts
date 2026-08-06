import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { isSmsConfigured } from '@/lib/communications/config'
import { resolveContactSmsTarget, sendOutboundSms } from '@/lib/sms/outbound'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/admin/contacts/[id]/send-sms
 *
 * Text a related person — trustee, adult child, referring professional —
 * rather than the client of record. The lead and matter routes cover the
 * client and spouse; this covers everyone else in the contact book.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { err, userId, user } = await requireAdmin(req)
  if (err) return err
  if (!isSmsConfigured()) {
    return NextResponse.json({ error: 'The selected SMS provider is not configured.' }, { status: 503 })
  }

  const { id } = await params
  const payload = (await req.json().catch(() => null)) as { body?: unknown } | null
  const message = typeof payload?.body === 'string' ? payload.body : ''
  if (!message.trim()) return NextResponse.json({ error: 'Message is required' }, { status: 400 })

  const { target, error } = await resolveContactSmsTarget(id)
  if (error) return NextResponse.json({ error }, { status: error === 'Contact not found' ? 404 : 400 })
  if (!target) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })

  const result = await sendOutboundSms(target, message, {
    id: userId as string,
    email: user?.email ?? null,
    name: (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? null,
  })

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, smsMessage: result.smsMessage, activity: result.activity },
      { status: result.status ?? 502 },
    )
  }

  return NextResponse.json({
    success: true,
    status: result.status,
    smsMessage: result.smsMessage,
    activity: result.activity,
  })
}
