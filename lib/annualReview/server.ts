import 'server-only'

import { getAdminClient } from '@/lib/supabaseAdmin'
import { clearFirmSettingsCache, loadFirmSettings } from '@/lib/firmSettings'
import { firmTodayKey } from '@/lib/firmDate'
import { portalUrl } from '@/lib/urls'
import {
  composeReviewEmail,
  outreachSummary,
  selectOutreach,
  settingsFromRow,
  type AnnualReviewCandidate,
  type AnnualReviewSettings,
  type OutreachPreview,
  type OutreachRow,
  type SkipReason,
} from '@/lib/annualReview/model'

/**
 * Annual review outreach: the half that touches records.
 *
 * The daily run reads every hired matter, decides who is due (model.ts),
 * drafts the invitation, records the cycle, and offers each send through the
 * delegation dial as `annual_review.outreach.send`. At Propose the card waits
 * on Today; at Act the email goes out at once and the digest lists it. The
 * settings here are the four `firm_settings` columns the campaign reads.
 *
 * Every read tolerates a database the migration has not reached yet: a
 * missing table or column reads as "nothing to do", never as a crash.
 */

type Admin = ReturnType<typeof getAdminClient>

export const ANNUAL_REVIEW_ACTION_KEY = 'annual_review.outreach.send'

const SETTINGS_COLUMNS = 'annual_review_outreach_enabled, annual_review_months_after_signing, annual_review_cadence_months, annual_review_lead_days'

function isMissingRelation(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  if (error.code === '42P01' || error.code === 'PGRST205' || error.code === '42703' || error.code === 'PGRST204') return true
  return /does not exist|could not find/i.test(error.message ?? '')
}

export async function loadAnnualReviewSettings(admin: Admin = getAdminClient()): Promise<AnnualReviewSettings> {
  const { data, error } = await admin.from('firm_settings').select(SETTINGS_COLUMNS).eq('id', 1).maybeSingle()
  if (error) {
    if (isMissingRelation(error)) return settingsFromRow(null)
    throw new Error(error.message)
  }
  return settingsFromRow((data as Record<string, unknown> | null) ?? null)
}

export async function updateAnnualReviewSettings(patch: Partial<AnnualReviewSettings>, admin: Admin = getAdminClient()): Promise<AnnualReviewSettings> {
  const update: Record<string, unknown> = {}
  if (patch.enabled !== undefined) update.annual_review_outreach_enabled = patch.enabled
  if (patch.monthsAfterSigning !== undefined) update.annual_review_months_after_signing = patch.monthsAfterSigning
  if (patch.cadenceMonths !== undefined) update.annual_review_cadence_months = patch.cadenceMonths
  if (patch.leadDays !== undefined) update.annual_review_lead_days = patch.leadDays
  if (Object.keys(update).length > 0) {
    const { error } = await admin.from('firm_settings').update(update).eq('id', 1)
    if (error) throw new Error(error.message)
    clearFirmSettingsCache()
  }
  return loadAnnualReviewSettings(admin)
}

interface MatterRow {
  id: string
  name: string
  status: string | null
  stage: string | null
  documents_executed_at: string | null
  signing_date: string | null
  client_intake_id: string | null
}

interface DetailsRow {
  client_id: string
  execution_date: string | null
  practice_area: string | null
  annual_review_opt_out?: boolean | null
}

interface IntakeRow {
  id: string
  email: string | null
  first_name: string | null
  full_name: string | null
  user_id: string | null
  client_user_id: string | null
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Every hired matter that is not archived, with what the decision needs. The
 * model decides; this only gathers. Returns null when the outreach table is
 * not there yet, so the run can say so instead of drafting into nothing.
 */
export async function listAnnualReviewCandidates(admin: Admin = getAdminClient()): Promise<AnnualReviewCandidate[] | null> {
  const { data: matters, error: mattersError } = await admin
    .from('matters')
    .select('id, name, status, stage, documents_executed_at, signing_date, client_intake_id')
    .eq('relationship_status', 'hired')
    .neq('status', 'archived')
    .limit(2000)
  if (mattersError) throw new Error(mattersError.message)
  const rows = (matters ?? []) as MatterRow[]
  if (rows.length === 0) return []

  const matterIds = rows.map(row => row.id)
  const intakeIds = Array.from(new Set(rows.map(row => row.client_intake_id).filter((id): id is string => Boolean(id))))

  const details = new Map<string, DetailsRow>()
  const intakes = new Map<string, IntakeRow>()
  const lastCycle = new Map<string, string>()

  for (const ids of chunk(matterIds, 200)) {
    let result = await admin.from('matter_details')
      .select('client_id, execution_date, practice_area, annual_review_opt_out')
      .in('client_id', ids)
    if (result.error && result.error.code === '42703') {
      // The opt-out column has not landed yet; read without it.
      result = await admin.from('matter_details').select('client_id, execution_date, practice_area').in('client_id', ids) as typeof result
    }
    if (result.error) throw new Error(result.error.message)
    for (const row of (result.data ?? []) as DetailsRow[]) details.set(row.client_id, row)

    const outreach = await admin.from('annual_review_outreach')
      .select('matter_id, cycle_due_on')
      .in('matter_id', ids)
      .order('cycle_due_on', { ascending: false })
    if (outreach.error) {
      if (isMissingRelation(outreach.error)) return null
      throw new Error(outreach.error.message)
    }
    for (const row of (outreach.data ?? []) as Array<{ matter_id: string; cycle_due_on: string }>) {
      if (!lastCycle.has(row.matter_id)) lastCycle.set(row.matter_id, row.cycle_due_on)
    }
  }

  for (const ids of chunk(intakeIds, 200)) {
    const { data, error } = await admin.from('client_intake')
      .select('id, email, first_name, full_name, user_id, client_user_id')
      .in('id', ids)
    if (error) throw new Error(error.message)
    for (const row of (data ?? []) as IntakeRow[]) intakes.set(row.id, row)
  }

  return rows.map(matter => {
    const detail = details.get(matter.id) ?? null
    const intake = matter.client_intake_id ? intakes.get(matter.client_intake_id) ?? null : null
    const anchor = detail?.execution_date
      ?? (matter.documents_executed_at ? matter.documents_executed_at.slice(0, 10) : null)
      ?? matter.signing_date
      ?? null
    const clientName = intake?.full_name?.trim() || matter.name
    return {
      matterId: matter.id,
      matterName: matter.name,
      clientName,
      clientFirstName: intake?.first_name?.trim() || null,
      clientEmail: intake?.email?.trim() || null,
      anchorOn: anchor,
      stage: matter.stage,
      status: matter.status,
      practiceArea: detail?.practice_area ?? null,
      optedOut: detail?.annual_review_opt_out === true,
      lastCycleDueOn: lastCycle.get(matter.id) ?? null,
      hasPortalAccount: Boolean(intake?.user_id || intake?.client_user_id),
    }
  })
}

function countSkips(skipped: Array<{ reason: SkipReason }>): Partial<Record<SkipReason, number>> {
  const counts: Partial<Record<SkipReason, number>> = {}
  for (const entry of skipped) counts[entry.reason] = (counts[entry.reason] ?? 0) + 1
  return counts
}

/** Who the next run would ask, for the Settings page. Reads only. */
export async function previewAnnualReviewOutreach(input: { today?: string } = {}): Promise<OutreachPreview> {
  const admin = getAdminClient()
  const today = input.today ?? firmTodayKey()
  const settings = await loadAnnualReviewSettings(admin)
  const candidates = await listAnnualReviewCandidates(admin)
  if (candidates === null) {
    return { enabled: settings.enabled, today, settings, unavailable: true, candidates: 0, due: [], skipped: {}, recent: [] }
  }
  const selection = selectOutreach(candidates, settings, today)
  const recentResult = await admin.from('annual_review_outreach')
    .select('id, matter_id, cycle_due_on, status, to_email, sent_at, created_at, matters(name)')
    .order('created_at', { ascending: false })
    .limit(20)
  const recent = recentResult.error
    ? []
    : ((recentResult.data ?? []) as Array<Record<string, unknown>>).map(row => ({
      id: String(row.id),
      matterId: String(row.matter_id),
      matterName: (row.matters as { name?: string } | null)?.name ?? null,
      cycleDueOn: String(row.cycle_due_on),
      status: String(row.status),
      toEmail: String(row.to_email),
      sentAt: (row.sent_at as string | null) ?? null,
      createdAt: String(row.created_at),
    }))
  return {
    enabled: settings.enabled,
    today,
    settings,
    unavailable: false,
    candidates: candidates.length,
    due: selection.due
      .sort((a, b) => a.dueOn.localeCompare(b.dueOn))
      .slice(0, 100)
      .map(entry => ({
        matterId: entry.candidate.matterId,
        matterName: entry.candidate.matterName,
        clientName: entry.candidate.clientName,
        clientEmail: entry.candidate.clientEmail,
        dueOn: entry.dueOn,
        yearsSinceSigning: entry.yearsSinceSigning,
      })),
    skipped: countSkips(selection.skipped),
    recent,
  }
}

export type OutreachDelegation = 'proposed' | 'sent' | 'observed' | 'duplicate' | 'failed'

/**
 * Offer one drafted invitation through the dial. Unlike an invoice reminder,
 * a review invitation at Propose is still worth a card: the card is the queue
 * the attorney works from, so the proposal is always created.
 */
export async function delegateAnnualReviewSend(
  row: Pick<OutreachRow, 'id' | 'matterId' | 'toEmail' | 'cycleDueOn'>,
  clientName: string | null,
  actorId: string,
): Promise<OutreachDelegation> {
  try {
    const { createActionProposal } = await import('@/lib/actions/server')
    const created = await createActionProposal({
      actionKey: ANNUAL_REVIEW_ACTION_KEY,
      displaySummary: outreachSummary(row, clientName),
      referencePayload: { outreachId: row.id },
      recordType: 'matter',
      recordId: row.matterId,
      source: 'automation',
      // One decision per cycle; the row itself is one per matter per due date.
      idempotencyKey: `annual-review:${row.id}`,
      applyAutonomy: true,
    }, { id: actorId })
    if (created.duplicate) return 'duplicate'
    if (created.autonomy === 'observe') return 'observed'
    if (created.execution) return created.execution.status === 'succeeded' ? 'sent' : 'failed'
    return 'proposed'
  } catch (error) {
    console.error('[annual review] delegation failed', { outreachId: row.id, cause: error instanceof Error ? error.message : String(error) })
    return 'failed'
  }
}

export interface OutreachRunResult {
  enabled: boolean
  /** True when the outreach table is not in the database yet; nothing was drafted. */
  unavailable: boolean
  today: string
  candidates: number
  due: number
  drafted: number
  proposed: number
  sent: number
  observed: number
  duplicates: number
  failed: number
  skipped: Partial<Record<SkipReason, number>>
}

/**
 * The daily run. Drafts an invitation for every matter whose review is due
 * and hands each to the dial. Without a staff actor (no attorney on file) the
 * drafts are recorded and wait for a person.
 */
export async function prepareAnnualReviewOutreach(input: { actorId: string | null; today?: string }): Promise<OutreachRunResult> {
  const admin = getAdminClient()
  const today = input.today ?? firmTodayKey()
  const settings = await loadAnnualReviewSettings(admin)
  const result: OutreachRunResult = {
    enabled: settings.enabled, unavailable: false, today,
    candidates: 0, due: 0, drafted: 0, proposed: 0, sent: 0, observed: 0, duplicates: 0, failed: 0, skipped: {},
  }
  if (!settings.enabled) return result

  const candidates = await listAnnualReviewCandidates(admin)
  if (candidates === null) return { ...result, unavailable: true }
  result.candidates = candidates.length
  const selection = selectOutreach(candidates, settings, today)
  result.due = selection.due.length
  result.skipped = countSkips(selection.skipped)
  if (selection.due.length === 0) return result

  const firm = await loadFirmSettings()

  for (const entry of selection.due) {
    const { candidate, dueOn, yearsSinceSigning } = entry
    if (!candidate.clientEmail) continue
    let booking: { url: string; label: string } | null = null
    try {
      const { resolveBookingLink } = await import('@/lib/bookings/bookingLink')
      booking = await resolveBookingLink({
        meetingTypeKey: 'client_call',
        name: candidate.clientName,
        email: candidate.clientEmail,
        matterId: candidate.matterId,
        channel: 'email',
      })
    } catch {
      // No booking page for a client call: the email asks for a reply instead.
      booking = null
    }
    const email = composeReviewEmail({
      firstName: candidate.clientFirstName,
      firmName: firm.firmName,
      attorneyShortName: firm.attorneyShortName,
      yearsSinceSigning,
      bookingUrl: booking?.url ?? null,
      bookingLabel: booking?.label ?? null,
      portalUrl: candidate.hasPortalAccount ? portalUrl('/documents') : null,
    })
    const inserted = await admin.from('annual_review_outreach').insert({
      matter_id: candidate.matterId,
      cycle_due_on: dueOn,
      status: 'drafted',
      to_email: candidate.clientEmail,
      subject: email.subject,
      body_text: email.text,
      body_html: email.html,
      booking_url: booking?.url ?? null,
    }).select('id').single()
    if (inserted.error) {
      if (inserted.error.code === '23505') { result.duplicates += 1; continue }
      console.error('[annual review] could not record outreach', { matterId: candidate.matterId, cause: inserted.error.message })
      result.failed += 1
      continue
    }
    result.drafted += 1
    if (!input.actorId) continue
    const outcome = await delegateAnnualReviewSend(
      { id: inserted.data.id as string, matterId: candidate.matterId, toEmail: candidate.clientEmail, cycleDueOn: dueOn },
      candidate.clientName,
      input.actorId,
    )
    if (outcome === 'proposed') result.proposed += 1
    else if (outcome === 'sent') result.sent += 1
    else if (outcome === 'observed') result.observed += 1
    else if (outcome === 'duplicate') result.duplicates += 1
    else result.failed += 1
  }
  return result
}

export interface OutreachRecord extends OutreachRow {
  bodyText: string
  bodyHtml: string
  bookingUrl: string | null
  matterName: string | null
  clientName: string | null
}

export async function fetchAnnualReviewOutreach(admin: Admin, outreachId: string): Promise<OutreachRecord | null> {
  const { data, error } = await admin.from('annual_review_outreach')
    .select('id, matter_id, cycle_due_on, status, to_email, subject, body_text, body_html, booking_url, sent_at, matters(name, client_intake_id)')
    .eq('id', outreachId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  const row = data as unknown as Record<string, unknown>
  const matter = (row.matters as { name?: string | null; client_intake_id?: string | null } | null) ?? null
  let clientName: string | null = null
  if (matter?.client_intake_id) {
    const intake = await admin.from('client_intake').select('full_name').eq('id', matter.client_intake_id).maybeSingle()
    clientName = (intake.data as { full_name?: string | null } | null)?.full_name?.trim() || null
  }
  return {
    id: String(row.id),
    matterId: String(row.matter_id),
    cycleDueOn: String(row.cycle_due_on),
    status: row.status as OutreachRow['status'],
    toEmail: String(row.to_email),
    subject: String(row.subject),
    sentAt: (row.sent_at as string | null) ?? null,
    bodyText: String(row.body_text),
    bodyHtml: String(row.body_html),
    bookingUrl: (row.booking_url as string | null) ?? null,
    matterName: matter?.name ?? null,
    clientName,
  }
}

export interface OutreachSendResult {
  sent: boolean
  status: 'sent' | 'redirected' | 'suppressed' | 'logged'
  outreachId: string
  matterId: string
  to: string
  messageId: string | null
}

/**
 * Send one drafted invitation: the email, the same words as a portal message
 * when the client has an account, the timeline entry, and the row marked
 * sent. A refused send marks the row failed and throws, so the proposal shows
 * the failure and the attorney can act.
 */
export async function sendAnnualReviewOutreach(args: { admin: Admin; outreachId: string; actorId: string }): Promise<OutreachSendResult> {
  const { admin, outreachId, actorId } = args
  const row = await fetchAnnualReviewOutreach(admin, outreachId)
  if (!row) throw new Error('Annual review invitation not found')
  if (row.status !== 'drafted') throw new Error('This invitation has already been sent or set aside')

  const [firm, matter] = await Promise.all([
    loadFirmSettings(),
    admin.from('matters').select('client_intake_id').eq('id', row.matterId).maybeSingle(),
  ])
  let hasPortalAccount = false
  const intakeId = (matter.data as { client_intake_id?: string | null } | null)?.client_intake_id ?? null
  if (intakeId) {
    const intake = await admin.from('client_intake').select('user_id, client_user_id').eq('id', intakeId).maybeSingle()
    const account = intake.data as { user_id?: string | null; client_user_id?: string | null } | null
    hasPortalAccount = Boolean(account?.user_id || account?.client_user_id)
  }

  const { sendEmail } = await import('@/lib/email/send')
  const result = await sendEmail({
    category: 'annual_review_outreach',
    to: row.toEmail,
    subject: row.subject,
    html: row.bodyHtml,
    text: row.bodyText,
    from: `${firm.attorneyShortName} <${firm.email}>`,
    matterId: row.matterId,
    useStoredTemplate: false,
  })
  if (!result.ok) {
    await admin.from('annual_review_outreach').update({ status: 'failed', error: result.error, updated_at: new Date().toISOString() }).eq('id', outreachId)
    throw new Error(result.error)
  }
  if (result.status === 'suppressed' || result.status === 'logged') {
    // The kill switch or a category turned off kept it in: not a failure of
    // this invitation, but nothing reached the client either.
    await admin.from('annual_review_outreach').update({ status: 'skipped', error: `Email ${result.status}: ${result.reason}`, updated_at: new Date().toISOString() }).eq('id', outreachId)
    return { sent: false, status: result.status, outreachId, matterId: row.matterId, to: row.toEmail, messageId: null }
  }

  let messageId: string | null = null
  if (hasPortalAccount) {
    const message = await admin.from('messages')
      .insert({ matter_id: row.matterId, sender_role: 'attorney', sender_id: actorId, body: row.bodyText })
      .select('id')
      .single()
    if (message.error) console.error('[annual review] portal message not posted', { outreachId, cause: message.error.message })
    else messageId = (message.data as { id: string }).id
  }

  const sentAt = new Date().toISOString()
  const { error: updateError } = await admin.from('annual_review_outreach')
    .update({ status: 'sent', sent_at: sentAt, sent_by: actorId, message_id: messageId, error: null, updated_at: sentAt })
    .eq('id', outreachId)
  if (updateError) throw new Error(updateError.message)

  await admin.from('matter_activity').insert({
    matter_id: row.matterId,
    event_type: 'email_sent',
    actor_id: actorId,
    actor_name: firm.attorneyShortName,
    title: `Annual review invitation sent: ${row.subject}`,
    detail: `To ${row.toEmail} · ${result.status}${messageId ? ' · also posted to the portal' : ''}`,
  })

  return { sent: true, status: result.status, outreachId, matterId: row.matterId, to: row.toEmail, messageId }
}
