import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { optOutPhoneKey } from '@/lib/sms/optOut'
import { markSmsThreadRead } from '@/lib/queries/smsThreads'
import { revalidateSidebarCounts } from '@/lib/sidebarCountsInvalidation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ phone: string }> }

/** POST /api/admin/texts/threads/[phone]/read — mark every inbound text from this number read. */
export async function POST(req: NextRequest, { params }: Params) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const phone = optOutPhoneKey(decodeURIComponent((await params).phone))
  if (!phone) return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 })
  try {
    const marked = await markSmsThreadRead(phone)
    if (marked > 0) revalidateSidebarCounts()
    return NextResponse.json({ success: true, marked })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to mark read' },
      { status: 500 },
    )
  }
}
