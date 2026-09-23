import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { optOutPhoneKey } from '@/lib/sms/optOut'
import { getSmsThreadMessages, getSmsThreadSummary } from '@/lib/queries/smsThreads'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ phone: string }> }

/** GET /api/admin/texts/threads/[phone] — one conversation, oldest message first. */
export async function GET(req: NextRequest, { params }: Params) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const phone = optOutPhoneKey(decodeURIComponent((await params).phone))
  if (!phone) return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 })
  try {
    const [thread, messages] = await Promise.all([
      getSmsThreadSummary(phone),
      getSmsThreadMessages(phone),
    ])
    return NextResponse.json({ phone, thread, messages })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load conversation' },
      { status: 500 },
    )
  }
}
