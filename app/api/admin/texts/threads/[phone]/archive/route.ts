import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { optOutPhoneKey } from '@/lib/sms/optOut'
import { getSmsThreadSummary, setSmsThreadArchived } from '@/lib/queries/smsThreads'
import { revalidateSidebarCounts } from '@/lib/sidebarCountsInvalidation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ phone: string }> }

/**
 * POST /api/admin/texts/threads/[phone]/archive
 * Body: { archived: boolean } — hide the conversation from the Texts list
 * (true) or bring it back (false). Messages stay on the linked record either
 * way, and a new incoming text brings an archived conversation back by itself.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const phone = optOutPhoneKey(decodeURIComponent((await params).phone))
  if (!phone) return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 })

  const body = (await req.json().catch(() => null)) as { archived?: unknown } | null
  if (typeof body?.archived !== 'boolean') {
    return NextResponse.json({ error: 'archived must be true or false' }, { status: 400 })
  }

  try {
    if (!(await getSmsThreadSummary(phone))) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }
    await setSmsThreadArchived(phone, body.archived, userId as string)
    revalidateSidebarCounts()
    return NextResponse.json({ success: true, thread: await getSmsThreadSummary(phone) })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update conversation' },
      { status: 500 },
    )
  }
}
