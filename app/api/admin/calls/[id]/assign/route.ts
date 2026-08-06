import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/apiAuth'
import { revalidateSidebarCounts } from '@/lib/sidebarCountsInvalidation'

const Body = z.object({
  matterId: z.string().min(1).optional(),
  leadId: z.string().min(1).optional(),
  contactId: z.string().min(1).optional(),
}).refine((body) => [body.matterId, body.leadId, body.contactId].filter(Boolean).length === 1, {
  message: 'Provide exactly one record id',
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Provide exactly one record id' }, { status: 400 })
  }

  const admin = getAdminClient()

  let matterId: string | null = null
  let leadId: string | null = null
  let contactId: string | null = null

  if (parsed.data.matterId) {
    const { data: matter } = await admin
      .from('matters')
      .select('id')
      .eq('id', parsed.data.matterId)
      .eq('relationship_status', 'hired')
      .maybeSingle()

    if (!matter) {
      return NextResponse.json({ error: 'Matter not found' }, { status: 404 })
    }
    matterId = parsed.data.matterId
  } else if (parsed.data.leadId) {
    const { data: lead } = await admin
      .from('client_intake')
      .select('id, matter_id')
      .eq('id', parsed.data.leadId!)
      .maybeSingle()

    const { data: opportunity } = lead?.matter_id
      ? await admin
          .from('matters')
          .select('relationship_status')
          .eq('id', lead.matter_id)
          .maybeSingle()
      : { data: null }

    if (!lead || !opportunity || opportunity.relationship_status === 'hired') {
      return NextResponse.json({ error: 'Lead not found or already hired' }, { status: 404 })
    }
    leadId = parsed.data.leadId
  } else {
    const { data: contact } = await admin
      .from('contacts')
      .select('id, client_intake_id, deceased')
      .eq('id', parsed.data.contactId!)
      .maybeSingle()

    if (!contact || contact.deceased) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
    }
    contactId = contact.id

    if (contact.client_intake_id) {
      const { data: intake } = await admin
        .from('client_intake')
        .select('id, matter_id')
        .eq('id', contact.client_intake_id)
        .maybeSingle()
      const { data: opportunity } = intake?.matter_id
        ? await admin
            .from('matters')
            .select('id, relationship_status')
            .eq('id', intake.matter_id)
            .maybeSingle()
        : { data: null }

      if (opportunity?.relationship_status === 'hired') matterId = opportunity.id
      else if (intake) leadId = intake.id
    }
  }

  const { data: updated, error } = await admin
    .from('calls')
    .update({
      matter_id: matterId,
      lead_id: leadId,
      contact_id: contactId,
      triage_dismissed_at: null,
      triage_dismissed_by: null,
      assigned_by: userId,
      assigned_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!updated) return NextResponse.json({ error: 'Call not found' }, { status: 404 })
  revalidateSidebarCounts()
  return NextResponse.json({ ok: true })
}
