import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/apiAuth'
import { normalizePracticeArea, practiceAreaLabel } from '@/lib/practiceArea'
import { ensureDesignSheetSeededFromIntake } from '@/lib/designSheet/ensureDesignSheetSeeded'
import { reconcileMatterIntakeTrack } from '@/lib/intake/reconcileMatterIntakeTrack'
import { generateUniqueMatterNumber } from '@/lib/matterNumber'
import { ensureMatterSlaTasks } from '@/lib/slaTasks/generate'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Matter numbers are allocated by reading the current max and adding one, so a
 *  concurrent create can take the same number. The unique index is the arbiter;
 *  reallocate and retry rather than failing the attorney's request. */
const MAX_NUMBER_ATTEMPTS = 3

export async function POST(req: Request) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const body = await req.json().catch(() => ({}))
  const clientName = typeof body.clientName === 'string' ? body.clientName.trim() : ''
  const clientEmail = typeof body.clientEmail === 'string' ? body.clientEmail.trim().toLowerCase() : ''
  const clientPhone = typeof body.clientPhone === 'string' ? body.clientPhone.trim() : null
  const planType = body.planType

  // Idempotency key from the caller: the same submission retried (double-click,
  // or a retry after a response we never received) resolves to one matter.
  const requestId =
    typeof body.requestId === 'string' && UUID_RE.test(body.requestId) ? body.requestId : null

  if (!clientName || !clientEmail) {
    return NextResponse.json({ error: 'clientName and clientEmail are required' }, { status: 400 })
  }

  const practiceArea = normalizePracticeArea(planType)
  const practiceAreaName = practiceAreaLabel(practiceArea)
  const admin = getAdminClient()

  const { data: clientUser, error: clientUserError } = await admin
    .from('users')
    .select('id')
    .eq('email', clientEmail)
    .maybeSingle()

  if (clientUserError) {
    return NextResponse.json(
      { error: `Failed to look up client account: ${clientUserError.message}` },
      { status: 500 },
    )
  }

  const nameParts = clientName.split(/\s+/)
  const first_name = nameParts[0] ?? clientName
  const last_name = nameParts.slice(1).join(' ') || null

  let lastError: { code?: string; message: string } | null = null

  for (let attempt = 0; attempt < MAX_NUMBER_ATTEMPTS; attempt += 1) {
    const matterNumber = await generateUniqueMatterNumber(admin, {
      year: new Date().getFullYear(),
      practiceArea,
      clientLastName: last_name,
      clientFirstName: first_name,
    })

    // One transaction: intake + matter + linkage + details + activity. Either the
    // whole matter exists or none of it does.
    const { data, error } = await admin.rpc('create_matter_with_client', {
      p_client_name: clientName,
      p_client_email: clientEmail,
      p_first_name: first_name,
      p_last_name: last_name,
      p_client_phone: clientPhone,
      p_practice_area: practiceArea,
      p_matter_name: `${clientName} — ${practiceAreaName}`,
      p_matter_number: matterNumber,
      p_client_user_id: clientUser?.id ?? null,
      p_actor_id: userId,
      p_request_id: requestId,
    })

    if (!error) {
      const row = Array.isArray(data) ? data[0] : data
      if (!row?.matter_id) {
        return NextResponse.json({ error: 'Matter create returned no row' }, { status: 500 })
      }

      // create_matter_with_client writes the practice area onto the intake but
      // not the questionnaire, so the row lands on the 'estate' column default.
      // A College Preparation Plan matter therefore opened the estate intake in
      // the attorney sheet and — because the seed reads the same field — seeded
      // an estate design sheet too. Must run before the seed.
      await reconcileMatterIntakeTrack(admin, row.matter_id, practiceArea)

      // Best-effort and idempotent; a failure here must not fail the request or
      // roll back a matter that already exists.
      try {
        await ensureDesignSheetSeededFromIntake(row.matter_id)
      } catch (e) {
        console.warn('design sheet seed on create skipped:', e)
      }

      // Kick off the SLA checklist. Also best-effort and idempotent — a retry
      // of the same submission must not double-generate it.
      await ensureMatterSlaTasks(row.matter_id, { practiceArea })

      return NextResponse.json({
        matterId: row.matter_id,
        matterNumber: row.matter_number,
        created: row.created !== false,
      })
    }

    lastError = error
    if (error.code !== '23505') break
  }

  return NextResponse.json(
    { error: `Failed to create matter: ${lastError?.message ?? 'unknown'}` },
    { status: 500 },
  )
}
