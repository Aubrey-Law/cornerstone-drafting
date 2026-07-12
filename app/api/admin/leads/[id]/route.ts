import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { deleteLead } from '@/lib/leads/deleteLead'
import { createMatterFromIntake } from '@/lib/matters/createFromIntake'
import { validateLeadDetails } from '@/lib/leads/details'
import { ZodError } from 'zod'

/**
 * PATCH /api/admin/leads/[id] — edit a lead (standalone client_intake row).
 * DELETE — delete a lead (guards converted leads; cleans up the envelope + R2).
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Status is normalized by validateLeadDetails (legacy leadStatus enum: ['lead', 'hired', 'lost']).
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const { id: intakeId } = await params
  const body = await req.json().catch(() => ({}))
  let details
  try { details = validateLeadDetails(body) }
  catch (error) { return NextResponse.json({ error: error instanceof ZodError ? error.issues[0]?.message ?? 'Invalid lead details' : 'Invalid lead details' }, { status: 400 }) }

  const admin = getAdminClient()
  const { data: lead } = await admin
    .from('client_intake')
    .select('*')
    .eq('id', intakeId)
    .maybeSingle()
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  if (lead.matter_id && details.status === 'hired') {
    const { data: spouse } = await admin.from('contacts').select('*').eq('client_intake_id', intakeId).eq('relationship_type', 'spouse').maybeSingle()
    return NextResponse.json({ lead, spouse: spouse ?? null, matterId: lead.matter_id })
  }
  if (lead.matter_id) {
    return NextResponse.json(
      { error: 'Lead already converted — edit it from the matter page.' },
      { status: 409 },
    )
  }

  const requestedHired = details.status === 'hired'
  const persistedDetails = requestedHired ? { ...details, status: lead.lead_status === 'lost' ? 'lost' : 'lead' } : details
  const { data: savedLead, error } = await admin.rpc('update_lead_details', {
    p_lead_id: intakeId, p_details: persistedDetails, p_spouse: details.spouse, p_actor_id: null,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  let matterId: string | undefined
  if (requestedHired) {
    const converted = await createMatterFromIntake(admin, intakeId, { actorId: userId ?? null })
    if (!converted.ok) {
      await admin.from('matters').delete().eq('client_intake_id', intakeId)
      await admin.from('client_intake').update({ lead_status: persistedDetails.status, matter_id: null }).eq('id', intakeId)
      return NextResponse.json({ error: converted.error }, { status: 500 })
    }
    matterId = converted.matterId
    await admin.from('client_intake').update({ lead_status: 'hired' }).eq('id', intakeId)
  }
  if (details.status === 'lost') { /* retained as a lead; the RPC persisted lost */ }
  const [{ data: persistedLead }, { data: spouse }] = await Promise.all([
    admin.from('client_intake').select('*').eq('id', intakeId).single(),
    admin.from('contacts').select('*').eq('client_intake_id', intakeId).eq('relationship_type', 'spouse').maybeSingle(),
  ])
  return NextResponse.json({ lead: persistedLead ?? savedLead, spouse: spouse ?? null, ...(matterId ? { matterId } : {}) })
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const { id: intakeId } = await params
  const admin = getAdminClient()
  try {
    await deleteLead(admin, intakeId)
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Could not delete lead'
    const status = msg === 'Lead not found' ? 404 : msg.includes('already converted') ? 409 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
