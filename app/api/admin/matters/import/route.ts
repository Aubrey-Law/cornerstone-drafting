import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { firmTodayKey } from '@/lib/firmDate'
import { generateUniqueMatterNumber } from '@/lib/matterNumber'
import { reconcileMatterIntakeTrack } from '@/lib/intake/reconcileMatterIntakeTrack'
import { ensureDesignSheetSeededFromIntake } from '@/lib/designSheet/ensureDesignSheetSeeded'
import { applySlaAnchor, ensureMatterSlaTasks } from '@/lib/slaTasks/generate'
import { syncEngagementSignedDetails } from '@/lib/engagement/signedDate'
import {
  detailsPatchFor,
  importActivityDetail,
  importedMatterName,
  matterPatchFor,
  parseImportMatterBody,
  phasesBefore,
} from '@/lib/matters/importMatter'

/** Matter numbers can collide on a concurrent create; the unique index decides. */
const MAX_NUMBER_ATTEMPTS = 3

const OPEN_STATUSES = ['open', 'in_progress', 'blocked']

/**
 * POST /api/admin/matters/import — bring in a matter that began outside
 * Cornerstone. See lib/matters/importMatter.ts for what it does and, as
 * importantly, what it deliberately does not: no stage engine, no billing
 * milestone, no plan unless asked for, and no email to anyone.
 */
export async function POST(req: Request) {
  const { err, userId, user } = await requireAdmin(req)
  if (err) return err

  const today = firmTodayKey()
  const parsed = parseImportMatterBody(await req.json().catch(() => ({})), today)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const input = parsed.input

  const admin = getAdminClient()

  const { data: clientUser, error: clientUserError } = await admin
    .from('users')
    .select('id')
    .eq('email', input.clientEmail)
    .maybeSingle()
  if (clientUserError) {
    return NextResponse.json({ error: `Failed to look up client account: ${clientUserError.message}` }, { status: 500 })
  }

  const nameParts = input.clientName.split(/\s+/)
  const firstName = nameParts[0] ?? input.clientName
  const lastName = nameParts.slice(1).join(' ') || null
  // An old matter keeps the year it was opened, not the year it was typed in.
  const openedYear = Number((input.dates.openedOn ?? input.dates.engagementSignedOn ?? today).slice(0, 4))

  let row: { matter_id: string; matter_number: string; created?: boolean } | null = null
  let lastError: { code?: string; message: string } | null = null
  for (let attempt = 0; attempt < MAX_NUMBER_ATTEMPTS; attempt += 1) {
    const matterNumber = input.matterNumber ?? await generateUniqueMatterNumber(admin, {
      year: openedYear,
      practiceArea: input.practiceArea,
      clientLastName: lastName,
      clientFirstName: firstName,
    })
    const { data, error } = await admin.rpc('create_matter_with_client', {
      p_client_name: input.clientName,
      p_client_email: input.clientEmail,
      p_first_name: firstName,
      p_last_name: lastName,
      p_client_phone: input.clientPhone,
      p_practice_area: input.practiceArea,
      p_matter_name: importedMatterName(input),
      p_matter_number: matterNumber,
      p_client_user_id: clientUser?.id ?? null,
      p_actor_id: userId,
      p_request_id: input.requestId,
    })
    if (!error) {
      row = (Array.isArray(data) ? data[0] : data) ?? null
      break
    }
    lastError = error
    if (error.code !== '23505') break
    // A number the attorney typed is theirs to change; only a generated one
    // is ours to retry.
    if (input.matterNumber) {
      return NextResponse.json({ error: `Matter number ${input.matterNumber} is already in use` }, { status: 409 })
    }
  }
  if (!row?.matter_id) {
    return NextResponse.json({ error: `Failed to import matter: ${lastError?.message ?? 'no row returned'}` }, { status: 500 })
  }
  const matterId = row.matter_id

  // The same submission retried resolves to the matter it already made, which
  // has already been brought in. Running the rest again would skip, re-date
  // and re-stamp a matter someone may have started working.
  if (row.created === false) {
    return NextResponse.json({ matterId, matterNumber: row.matter_number, created: false })
  }

  const warnings: string[] = []

  await reconcileMatterIntakeTrack(admin, matterId, input.practiceArea)
  try {
    await ensureDesignSheetSeededFromIntake(matterId)
  } catch (e) {
    console.warn('[matter-import] design sheet seed skipped', matterId, e)
  }

  // ── Plan: only the work still ahead, or none ────────────────────────────
  // Generated before any real date is written: generation reads the matter's
  // anchors, and an engagement signed in 2023 would date every remaining task
  // years overdue and set the client nudges off at once. The remaining work is
  // dated from today instead — the day the firm picks it up.
  let skippedTasks = 0
  if (input.plan === 'remaining') {
    await ensureMatterSlaTasks(matterId, { practiceArea: input.practiceArea })
    const anchored = await applySlaAnchor(admin, matterId, 'engagement', today)
    if (!anchored.ok) warnings.push('The plan could not be dated; set its key dates on the Tasks tab.')
    const earlier = phasesBefore(input.stage)
    if (earlier.length > 0) {
      const now = new Date().toISOString()
      const { data: skipped, error: skipError } = await admin
        .from('tasks')
        .update({ status: 'archived', skipped_at: now, completed_at: null, closeout_reason: null })
        .eq('matter_id', matterId)
        .eq('source', 'sla')
        .in('status', OPEN_STATUSES)
        .in('phase', earlier)
        .select('id')
      if (skipError) warnings.push(`Earlier-stage tasks could not be skipped: ${skipError.message}`)
      skippedTasks = skipped?.length ?? 0
    }
  }

  // ── Stage, real dates and the import stamp ──────────────────────────────
  // A direct write rather than the stage RPC: that RPC fires the stage engine
  // and releases billing milestones, which are for work happening now.
  const now = new Date().toISOString()
  const matterPatch = matterPatchFor(input, now)
  let { error: matterError } = await admin.from('matters').update(matterPatch).eq('id', matterId)
  if (matterError && /imported_at/.test(matterError.message)) {
    // The column ships in a migration that can land a minute after the code.
    const { imported_at: _stamp, ...rest } = matterPatch
    ;({ error: matterError } = await admin.from('matters').update(rest).eq('id', matterId))
    if (!matterError) warnings.push('Imported, but the import marker is not available yet.')
  }
  if (matterError) {
    return NextResponse.json(
      { error: `Matter created but its stage and dates could not be set: ${matterError.message}`, matterId },
      { status: 500 },
    )
  }

  const detailsPatch = detailsPatchFor(input)
  if (Object.keys(detailsPatch).length > 0) {
    const { error: detailsError } = await admin
      .from('matter_details')
      .upsert({ client_id: matterId, ...detailsPatch }, { onConflict: 'client_id' })
    if (detailsError) warnings.push(`Some dates could not be saved: ${detailsError.message}`)
  }
  if (input.dates.engagementSignedOn) {
    const { error: engagementError } = await syncEngagementSignedDetails(
      admin,
      matterId,
      `${input.dates.engagementSignedOn}T12:00:00.000Z`,
    )
    if (engagementError) warnings.push(`The engagement date could not be saved: ${engagementError}`)
  }

  const actorName = (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? null
  await admin.from('matter_activity').insert({
    matter_id: matterId,
    event_type: 'matter_created',
    title: 'Brought in from outside Cornerstone',
    detail: importActivityDetail(input, skippedTasks),
    metadata: { imported: true, stage: input.stage, plan: input.plan, dates: input.dates, skippedTasks },
    actor_id: userId,
    actor_email: user?.email ?? null,
    actor_name: actorName,
  })

  return NextResponse.json({
    matterId,
    matterNumber: row.matter_number,
    created: true,
    stage: input.stage,
    skippedTasks,
    warnings,
  })
}
