import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { prepareLawmaticsBooking } from '@/lib/integrations/lawmatics/bookingLink'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST { target: { leadId } | { matterId } } — "Book for client" on a Lawmatics
 * booking page: push the lead to Lawmatics first so the booking staff make
 * lands on the linked prospect (see lib/integrations/lawmatics/bookingLink.ts).
 * Always 200 once validated; a failed push comes back as `warning`.
 */
export async function POST(req: NextRequest) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const body = await req.json().catch(() => null) as { target?: { leadId?: unknown; matterId?: unknown } } | null
  const leadId = typeof body?.target?.leadId === 'string' ? body.target.leadId.trim() : ''
  const matterId = typeof body?.target?.matterId === 'string' ? body.target.matterId.trim() : ''
  if (Boolean(leadId) === Boolean(matterId) || !UUID.test(leadId || matterId)) {
    return NextResponse.json({ error: 'Pass exactly one valid target.leadId or target.matterId' }, { status: 400 })
  }

  const result = await prepareLawmaticsBooking({ leadId: leadId || null, matterId: matterId || null }, userId)
  return NextResponse.json({ prospectId: result.prospectId, operation: result.operation, warning: result.warning })
}
