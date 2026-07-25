import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { createLead } from '@/lib/leads/createLead'

/**
 * POST /api/admin/leads — create an intake-backed lead opportunity. The
 * database creates its unnumbered matter in the same transaction; hiring later
 * assigns the official number and enables drafting and client access.
 */
export async function POST(req: Request) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const body = (await req.json().catch(() => ({}))) as {
    clientName?: string
    clientEmail?: string
    clientPhone?: string
    practiceArea?: string
    feeQuoted?: number | null
  }
  const clientName = typeof body.clientName === 'string' ? body.clientName.trim() : ''
  const clientEmail = typeof body.clientEmail === 'string' ? body.clientEmail.trim() : ''
  if (!clientName || !clientEmail) {
    return NextResponse.json({ error: 'clientName and clientEmail are required' }, { status: 400 })
  }
  try {
    const lead = await createLead({
      clientName,
      clientEmail,
      clientPhone: typeof body.clientPhone === 'string' ? body.clientPhone : null,
      practiceArea: body.practiceArea,
      feeQuoted: body.feeQuoted,
    })
    return NextResponse.json({ leadId: lead.leadId })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create lead'
    return NextResponse.json(
      { error: message },
      { status: message === 'Invalid practice area' ? 400 : 500 },
    )
  }
}
