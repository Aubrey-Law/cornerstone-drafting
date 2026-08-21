import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/apiAuth'
import { normalizePracticeArea, practiceAreaLabel } from '@/lib/practiceArea'
import { ensureDesignSheetSeededFromIntake } from '@/lib/designSheet/ensureDesignSheetSeeded'
import { generateUniqueMatterNumber } from '@/lib/matterNumber'
import { ensureMatterSlaTasks } from '@/lib/slaTasks/generate'
import { durableWorkflowJobsEnabled, enqueueWorkflowJob } from '@/lib/workflowJobs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Same as the create route: the unique index on matter_number is the arbiter. */
const MAX_NUMBER_ATTEMPTS = 3

/**
 * POST /api/admin/matters/open-for-person — open a matter for someone the firm
 * already knows.
 *
 * The counterpart to /api/admin/matters/create, which always mints a new
 * person. This one takes an existing `contacts` row, so a returning client or a
 * child getting their own College Prep plan reuses the person the firm already
 * has instead of duplicating them and their household.
 */
export async function POST(req: Request) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const body = await req.json().catch(() => ({}))
  const contactId = typeof body.contactId === 'string' ? body.contactId.trim() : ''
  const carryHousehold = body.carryHousehold !== false
  const extraContactIds = Array.isArray(body.extraContactIds)
    ? body.extraContactIds.filter((id: unknown): id is string => typeof id === 'string' && UUID_RE.test(id))
    : []
  const requestId =
    typeof body.requestId === 'string' && UUID_RE.test(body.requestId) ? body.requestId : null

  if (!UUID_RE.test(contactId)) {
    return NextResponse.json({ error: 'contactId is required' }, { status: 400 })
  }

  const practiceArea = normalizePracticeArea(body.planType)
  const practiceAreaName = practiceAreaLabel(practiceArea)
  const admin = getAdminClient()

  const { data: person, error: personError } = await admin
    .from('contacts')
    .select('id, first_name, last_name, email')
    .eq('id', contactId)
    .maybeSingle()
  if (personError) {
    return NextResponse.json({ error: `Failed to look up person: ${personError.message}` }, { status: 500 })
  }
  if (!person) return NextResponse.json({ error: 'Person not found' }, { status: 404 })

  const clientName = [person.first_name, person.last_name].filter(Boolean).join(' ').trim()
    || person.email
    || 'Client'

  // A returning client may already have a portal login under this email.
  const { data: clientUser } = person.email
    ? await admin.from('users').select('id').eq('email', person.email).maybeSingle()
    : { data: null }

  let lastError: { code?: string; message: string } | null = null

  for (let attempt = 0; attempt < MAX_NUMBER_ATTEMPTS; attempt += 1) {
    const matterNumber = await generateUniqueMatterNumber(admin, {
      year: new Date().getFullYear(),
      practiceArea,
      clientLastName: person.last_name ?? null,
      clientFirstName: person.first_name ?? clientName,
    })

    const { data, error } = await admin.rpc('open_matter_for_person', {
      p_contact_id: contactId,
      p_practice_area: practiceArea,
      p_matter_name: `${clientName} — ${practiceAreaName}`,
      p_matter_number: matterNumber,
      p_carry_household: carryHousehold,
      p_extra_contact_ids: extraContactIds,
      p_client_user_id: clientUser?.id ?? null,
      p_actor_id: userId,
      p_request_id: requestId,
    })

    const row = Array.isArray(data) ? data[0] : data
    if (!error && row?.matter_id) {
      const durableJobs = await durableWorkflowJobsEnabled()
      if (durableJobs) {
        await Promise.all([
          enqueueWorkflowJob({ type: 'seed_design_sheet', dedupeKey: `design-sheet-seed:${row.matter_id}`, matterId: row.matter_id, actorId: userId }),
          enqueueWorkflowJob({ type: 'ensure_sla_plan', dedupeKey: `sla-plan:${row.matter_id}:${practiceArea}`, matterId: row.matter_id, payload: { practiceArea }, actorId: userId }),
        ])
      } else {
        try {
          await ensureDesignSheetSeededFromIntake(row.matter_id)
        } catch (e) {
          console.warn('design sheet seed on open-for-person skipped:', e)
        }
        await ensureMatterSlaTasks(row.matter_id, { practiceArea })
      }

      return NextResponse.json({
        matterId: row.matter_id,
        matterNumber: row.matter_number,
        created: row.created !== false,
      })
    }

    lastError = error
    // Only a matter-number collision is worth retrying; anything else is real.
    if (error?.code !== '23505') break
  }

  return NextResponse.json(
    { error: `Failed to open matter: ${lastError?.message ?? 'unknown'}` },
    { status: 500 },
  )
}
