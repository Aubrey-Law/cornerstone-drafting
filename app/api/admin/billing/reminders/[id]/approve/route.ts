import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { InvoiceReminderError, sendInvoiceReminder } from '@/lib/billing/sendInvoiceReminder'
import { getAdminClient } from '@/lib/supabaseAdmin'

type Params = { params: Promise<{ id: string }> }

/**
 * Approve and send one drafted reminder. The send itself lives in
 * lib/billing/sendInvoiceReminder.ts, shared with the delegation dial's
 * `billing.reminder.send` action.
 */
export async function POST(req: Request, { params }: Params) {
  const auth = await requireAdmin(req)
  if (auth.err || !auth.userId) return auth.err ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const reminderId = (await params).id
  try {
    await sendInvoiceReminder({ admin: getAdminClient(), reminderId, actorId: auth.userId })
    return NextResponse.json({ sent: true })
  } catch (error) {
    if (error instanceof InvoiceReminderError) return NextResponse.json({ error: error.message }, { status: 409 })
    throw error
  }
}
