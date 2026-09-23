import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { optOutPhoneKey } from '@/lib/sms/optOut'
import { getSmsThreadMessages, getSmsThreadSummary, softDeleteSmsThread } from '@/lib/queries/smsThreads'
import { revalidateSidebarCounts } from '@/lib/sidebarCountsInvalidation'

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

/**
 * DELETE /api/admin/texts/threads/[phone] — hide the whole conversation. Soft:
 * rows keep their content with who deleted them and when. A later text from
 * the number starts a fresh conversation; an opt-out still stands.
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const phone = optOutPhoneKey(decodeURIComponent((await params).phone))
  if (!phone) return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 })
  try {
    const deleted = await softDeleteSmsThread(phone, userId as string)
    if (deleted === 0) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    revalidateSidebarCounts()
    return NextResponse.json({ success: true, deleted })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete conversation' },
      { status: 500 },
    )
  }
}
