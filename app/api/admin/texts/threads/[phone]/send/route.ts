import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { isSmsConfigured } from '@/lib/communications/config'
import { optOutPhoneKey } from '@/lib/sms/optOut'
import { sendOutboundSms } from '@/lib/sms/outbound'
import { threadSendTarget } from '@/lib/sms/threadTarget'
import { getSmsThreadSummary } from '@/lib/queries/smsThreads'
import { revalidateSidebarCounts } from '@/lib/sidebarCountsInvalidation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ phone: string }> }

function optionalId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * POST /api/admin/texts/threads/[phone]/send
 * Body: { body: string, link?: { leadId?, matterId?, contactId?, name? } }
 *
 * Replies in a conversation, or starts one. `link` only applies when the
 * number has no conversation yet (the "New text" picker); an existing
 * conversation keeps the record it is already linked to.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { err, userId, user } = await requireAdmin(req)
  if (err) return err
  if (!isSmsConfigured()) {
    return NextResponse.json({ error: 'Texting is not configured.' }, { status: 503 })
  }

  const phone = optOutPhoneKey(decodeURIComponent((await params).phone))
  if (!phone) return NextResponse.json({ error: 'Enter a 10-digit US phone number.' }, { status: 400 })

  const payload = (await req.json().catch(() => null)) as
    | { body?: unknown; link?: Record<string, unknown> | null }
    | null
  const message = typeof payload?.body === 'string' ? payload.body.trim() : ''
  if (!message) return NextResponse.json({ error: 'Message is required' }, { status: 400 })

  let thread
  try {
    thread = await getSmsThreadSummary(phone)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load conversation' },
      { status: 500 },
    )
  }

  const rawLink = payload?.link
  const link = rawLink && typeof rawLink === 'object'
    ? {
        leadId: optionalId(rawLink.leadId),
        matterId: optionalId(rawLink.matterId),
        contactId: optionalId(rawLink.contactId),
        name: typeof rawLink.name === 'string' ? rawLink.name : null,
      }
    : null

  const { target, maxLength } = threadSendTarget({ phone, thread, link })
  if (message.length > maxLength) {
    return NextResponse.json(
      { error: `Message must be ${maxLength} characters or fewer` },
      { status: 400 },
    )
  }

  const result = await sendOutboundSms(target, message, {
    id: userId as string,
    email: user?.email ?? null,
    name: (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? null,
  })
  revalidateSidebarCounts()

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, smsMessage: result.smsMessage ?? null },
      { status: result.status ?? 502 },
    )
  }
  return NextResponse.json({ success: true, status: result.status, smsMessage: result.smsMessage })
}
