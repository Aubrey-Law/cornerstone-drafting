import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { optOutPhoneKey } from '@/lib/sms/optOut'
import { getSmsThreadSummary, linkSmsThread } from '@/lib/queries/smsThreads'
import { revalidateSidebarCounts } from '@/lib/sidebarCountsInvalidation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ phone: string }> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function uuidOrNull(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value.trim()) ? value.trim() : null
}

/**
 * POST /api/admin/texts/threads/[phone]/link
 * Body: { leadId?, matterId?, contactId? } — attach an unknown sender's
 * conversation to a record. Existing links on individual messages are kept.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const phone = optOutPhoneKey(decodeURIComponent((await params).phone))
  if (!phone) return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const link = {
    leadId: uuidOrNull(body.leadId),
    matterId: uuidOrNull(body.matterId),
    contactId: uuidOrNull(body.contactId),
  }
  if (!link.leadId && !link.matterId && !link.contactId) {
    return NextResponse.json({ error: 'Choose a lead, client or contact to link.' }, { status: 400 })
  }

  try {
    await linkSmsThread(phone, link)
    revalidateSidebarCounts()
    return NextResponse.json({ success: true, thread: await getSmsThreadSummary(phone) })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to link conversation' },
      { status: 500 },
    )
  }
}
