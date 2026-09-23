import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { createLead } from '@/lib/leads/createLead'
import { optOutPhoneKey } from '@/lib/sms/optOut'
import { getSmsThreadSummary, linkSmsThread } from '@/lib/queries/smsThreads'
import { revalidateSidebarCounts } from '@/lib/sidebarCountsInvalidation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ phone: string }> }

/**
 * POST /api/admin/texts/threads/[phone]/create-lead
 * Body: { clientName, clientEmail, practiceArea? } — make a lead for an
 * unknown texter with this number, then attach the conversation to it.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const phone = optOutPhoneKey(decodeURIComponent((await params).phone))
  if (!phone) return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const clientName = typeof body.clientName === 'string' ? body.clientName.trim() : ''
  const clientEmail = typeof body.clientEmail === 'string' ? body.clientEmail.trim() : ''
  if (!clientName || !clientEmail) {
    return NextResponse.json({ error: 'Name and email are required' }, { status: 400 })
  }

  try {
    const lead = await createLead({
      clientName,
      clientEmail,
      clientPhone: `+1${phone}`,
      practiceArea: typeof body.practiceArea === 'string' ? body.practiceArea : undefined,
    })
    await linkSmsThread(phone, { leadId: lead.leadId })
    revalidateSidebarCounts()
    return NextResponse.json({ leadId: lead.leadId, thread: await getSmsThreadSummary(phone) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create lead'
    return NextResponse.json(
      { error: message },
      { status: message === 'Invalid practice area' ? 400 : 500 },
    )
  }
}
