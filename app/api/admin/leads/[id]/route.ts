import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { deleteLead } from '@/lib/leads/deleteLead'
import { createMatterFromIntake } from '@/lib/matters/createFromIntake'
import { validateLeadDetails, validateLeadFieldPatch } from '@/lib/leads/details'
import type { ValidatedLeadDetails } from '@/lib/leads/details'
import { z, ZodError } from 'zod'
import { loadSpouseContact } from '@/lib/contacts/loadSpouseContact'
import {
  archiveTasksForClosedRecord,
  restoreTasksForReopenedRecord,
  type CloseoutReason,
} from '@/lib/tasks/closeout'

const snoozeRequestSchema = z.object({
  nextActionSnoozedUntil: z.union([
    z.string()
      .datetime({ offset: true, message: 'Invalid snooze time' })
      .refine(value => new Date(value).getTime() > Date.now(), 'Snooze time must be in the future'),
    z.null(),
  ]),
}).strict()

const statusRequestSchema = z.object({
  status: z.enum(['lead', 'lost', 'declined']),
}).strict()

function validationError(error: unknown) {
  if (error instanceof ZodError) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of error.issues) {
      const key = issue.path.join('.').replace(/^spouse\./, 'spouse').replace(/\.([a-z])/g, (_, c) => c.toUpperCase())
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message
    }
    return NextResponse.json(
      { error: error.issues[0]?.message ?? 'Invalid lead details', fieldErrors },
      { status: 400 },
    )
  }
  return NextResponse.json({ error: 'Invalid lead details' }, { status: 400 })
}

function hasOwn(value: unknown, key: string): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Object.prototype.hasOwnProperty.call(value, key)
}

/**
 * A lead that stops being a live opportunity stops needing its checklist, and
 * one that comes back needs it again. Both directions run off the status the
 * lead just moved to; anything else (including 'hired', which converts and
 * keeps its plan) leaves the tasks alone.
 */
const CLOSEOUT_BY_LEAD_STATUS: Record<string, CloseoutReason> = {
  lost: 'lead_lost',
  declined: 'lead_declined',
}

async function syncLeadTasksToStatus(
  admin: ReturnType<typeof getAdminClient>,
  leadId: string,
  matterId: string | null,
  status: string,
  actor: { id: string | null },
): Promise<void> {
  const target = { leadId, matterId }
  const reason = CLOSEOUT_BY_LEAD_STATUS[status]
  if (reason) await archiveTasksForClosedRecord(admin, target, reason, actor)
  else if (status === 'lead') await restoreTasksForReopenedRecord(admin, target, actor)
}

function atomicUpdateErrorStatus(error: { code?: string | null; message: string }) {
  if (error.code === 'P0002' || error.message.trim().toLowerCase() === 'lead not found') return 404
  if (/already (?:converted|hired)/i.test(error.message)) return 409
  return 500
}

function spouseResponse(details: ValidatedLeadDetails['spouse']) {
  if (!details) return null
  return {
    first_name: details.firstName,
    middle_name: details.middleName,
    last_name: details.lastName,
    preferred_name: details.preferredName,
    email: details.email,
    phone: details.phone,
    date_of_birth: details.dateOfBirth,
  }
}

/**
 * PATCH /api/admin/leads/[id] — edit a lead (standalone client_intake row).
 * DELETE — archive a prospective matter while retaining its history.
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

  if (hasOwn(body, 'nextActionSnoozedUntil')) {
    let snooze
    try { snooze = snoozeRequestSchema.parse(body) }
    catch (error) { return validationError(error) }

    const { data, error } = await getAdminClient().rpc('snooze_lead_next_action', {
      p_lead_id: intakeId,
      p_until: snooze.nextActionSnoozedUntil,
      p_actor_id: userId,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  const statusOnlyRequest = hasOwn(body, 'status') && Object.keys(body).length === 1
  if (statusOnlyRequest) {
    let statusChange
    try { statusChange = statusRequestSchema.parse(body) }
    catch (error) { return validationError(error) }

    const admin = getAdminClient()
    const { data, error } = await admin.rpc('update_lead_opportunity_status', {
      p_lead_id: intakeId,
      p_status: statusChange.status,
      p_actor_id: userId,
    })
    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: atomicUpdateErrorStatus(error) },
      )
    }
    // The RPC returns the lead it just wrote, which is where the matter behind
    // this opportunity — and so its generated plan — hangs off.
    const matterId = (data as { lead?: { matter_id?: string | null } } | null)?.lead?.matter_id ?? null
    await syncLeadTasksToStatus(admin, intakeId, matterId, statusChange.status, { id: userId })
    return NextResponse.json(data)
  }

  const partialRequest = hasOwn(body, 'field')
  if (partialRequest) {
    let patch
    try { patch = validateLeadFieldPatch(body) }
    catch (error) { return validationError(error) }

    const { data, error } = await getAdminClient().rpc('update_lead_opportunity_field', {
      p_lead_id: intakeId,
      p_field: patch.field,
      p_value: patch.value,
      p_actor_id: userId,
    })
    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: atomicUpdateErrorStatus(error) },
      )
    }
    return NextResponse.json(data)
  }

  let legacyDetails: ValidatedLeadDetails | null = null
  try { legacyDetails = validateLeadDetails(body) }
  catch (error) { return validationError(error) }

  const admin = getAdminClient()
  const { data: lead, error: leadReadError } = await admin
    .from('client_intake')
    .select('*')
    .eq('id', intakeId)
    .maybeSingle()
  if (leadReadError) return NextResponse.json({ error: leadReadError.message }, { status: 500 })
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

  const [spouseResult, opportunityResult] = await Promise.all([
    // Read through the join (step 3 of docs/matter-contacts-migration.md); the
    // lead row above already carries its matter, so no extra lookup. '*'
    // because callers format the spouse's address.
    lead.matter_id
      ? loadSpouseContact(admin, lead.matter_id as string, '*').then(
          data => ({ data: data as Record<string, unknown> | null, error: null as { message: string } | null }),
          (error: Error) => ({ data: null, error: { message: error.message } }),
        )
      : Promise.resolve({ data: null, error: null }),
    lead.matter_id
      ? admin.from('matters').select('id, relationship_status').eq('id', lead.matter_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  if (spouseResult.error) return NextResponse.json({ error: spouseResult.error.message }, { status: 500 })
  if (opportunityResult.error) return NextResponse.json({ error: opportunityResult.error.message }, { status: 500 })
  const spouse = spouseResult.data
  const opportunity = opportunityResult.data

  let details: ValidatedLeadDetails
  if (legacyDetails) {
    details = legacyDetails
  } else {
    return NextResponse.json({ error: 'Invalid lead details' }, { status: 400 })
  }

  if (!partialRequest && opportunity?.relationship_status === 'hired' && details.status === 'hired') {
    return NextResponse.json({ lead, spouse: spouse ?? null, matterId: lead.matter_id })
  }
  if (opportunity?.relationship_status === 'hired') {
    return NextResponse.json(
      { error: 'Lead already converted — edit it from the matter page.' },
      { status: 409 },
    )
  }

  const requestedHired = !partialRequest && details.status === 'hired'
  if (requestedHired && opportunity?.relationship_status === 'lost') {
    return NextResponse.json(
      { error: 'Reactivate the lost opportunity as Lead before hiring it.' },
      { status: 409 },
    )
  }
  const persistedDetails = requestedHired ? { ...details, status: lead.lead_status === 'lost' ? 'lost' : 'lead' } : details
  const { data: savedLead, error } = await admin.rpc('update_lead_opportunity_details', {
    p_lead_id: intakeId, p_details: persistedDetails, p_spouse: details.spouse, p_actor_id: userId,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  let matterId: string | undefined
  if (requestedHired) {
    const converted = await createMatterFromIntake(admin, intakeId, { actorId: userId ?? null })
    if (!converted.ok) {
      return NextResponse.json({ error: converted.error }, { status: 500 })
    }
    matterId = converted.matterId
  }
  // The lead form can move status too, so the same sweep runs here. Read from
  // what was persisted, not from `details`: hiring rewrites the status on its
  // way to conversion, and that matter keeps its plan.
  if (!requestedHired) {
    await syncLeadTasksToStatus(
      admin,
      intakeId,
      (lead.matter_id as string | null) ?? null,
      persistedDetails.status,
      { id: userId },
    )
  }
  const [persistedLeadResult, persistedSpouseResult] = await Promise.all([
    admin.from('client_intake').select('*').eq('id', intakeId).single(),
    // The just-converted matter when conversion happened, otherwise the lead's
    // existing one — either way the join is keyed on a matter, not on the
    // household. Falling back matters: without it every non-converting PATCH
    // would return a null spouse.
    (matterId ?? (lead.matter_id as string | null))
      ? loadSpouseContact(admin, (matterId ?? lead.matter_id) as string, '*').then(
          data => ({ data: data as Record<string, unknown> | null, error: null as { message: string } | null }),
          (error: Error) => ({ data: null, error: { message: error.message } }),
        )
      : Promise.resolve({ data: null, error: null as { message: string } | null }),
  ])
  const fallbackLead = matterId
    ? { ...savedLead, lead_status: 'hired', matter_id: matterId }
    : savedLead
  const response = {
    lead: persistedLeadResult.data ?? fallbackLead,
    spouse: persistedSpouseResult.error
      ? spouseResponse(details.spouse)
      : persistedSpouseResult.data ?? null,
    ...(matterId ? { matterId } : {}),
  }
  const refreshWarning = persistedLeadResult.error && persistedSpouseResult.error
    ? 'Saved, but refreshed lead and spouse data are unavailable.'
    : persistedLeadResult.error
      ? 'Saved, but refreshed lead data is unavailable.'
      : persistedSpouseResult.error
        ? 'Saved, but refreshed spouse data is unavailable.'
        : null
  return NextResponse.json(refreshWarning ? { ...response, refreshWarning } : response)
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
