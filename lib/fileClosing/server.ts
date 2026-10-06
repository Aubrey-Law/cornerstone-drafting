import 'server-only'

import { after } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { clearFirmSettingsCache, loadFirmSettings } from '@/lib/firmSettings'
import { firmTodayKey } from '@/lib/firmDate'
import { portalUrl } from '@/lib/urls'
import {
  closingNoticeSummary,
  composeClosingNotice,
  describePlan,
  parseSettingsPatch as parseFileClosingPatch,
  retentionReviewTask,
  retentionUntil,
  selectRetentionReview,
  settingsFromRow,
  type FileClosingSettings,
  type RetentionCandidate,
} from '@/lib/fileClosing/model'

/**
 * File closing and retention: the half that touches records.
 *
 * `finishMatterClose` runs after either close path (the stage route's Close
 * matter, or the status dropdown) and does what closing should always have
 * done: stamp the closed date, set the retention date, and offer the client a
 * closing notice through the delegation dial. `prepareRetentionReview` is the
 * weekly run that lists files past their date. Every read tolerates a database
 * the migration has not reached yet.
 */

type Admin = ReturnType<typeof getAdminClient>

export const CLOSING_NOTICE_ACTION_KEY = 'matter.closing.notice.send'

export { parseFileClosingPatch }

function isMissingRelation(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  if (error.code === '42P01' || error.code === 'PGRST205' || error.code === '42703' || error.code === 'PGRST204') return true
  return /does not exist|could not find/i.test(error.message ?? '')
}

export async function loadFileClosingSettings(admin: Admin = getAdminClient()): Promise<FileClosingSettings> {
  const { data, error } = await admin.from('firm_settings').select('file_retention_years, closing_notice_enabled').eq('id', 1).maybeSingle()
  if (error) {
    if (isMissingRelation(error)) return settingsFromRow(null)
    throw new Error(error.message)
  }
  return settingsFromRow((data as Record<string, unknown> | null) ?? null)
}

export async function updateFileClosingSettings(patch: Partial<FileClosingSettings>, admin: Admin = getAdminClient()): Promise<FileClosingSettings> {
  const update: Record<string, unknown> = {}
  if (patch.retentionYears !== undefined) update.file_retention_years = patch.retentionYears
  if (patch.closingNoticeEnabled !== undefined) update.closing_notice_enabled = patch.closingNoticeEnabled
  if (Object.keys(update).length > 0) {
    const { error } = await admin.from('firm_settings').update(update).eq('id', 1)
    if (error) throw new Error(error.message)
    clearFirmSettingsCache()
  }
  return loadFileClosingSettings(admin)
}

export interface CloseActor {
  id: string
  email?: string | null
  name?: string | null
}

/**
 * What closing leaves on the record, whichever route closed it. Idempotent:
 * a date already stamped is kept, so the status dropdown after the Close-out
 * card (or the reverse) changes nothing. Never throws into the caller's
 * response: the close itself has committed by the time this runs.
 */
export async function finishMatterClose(admin: Admin, input: { matterId: string; actor: CloseActor; today?: string }): Promise<{ closedOn: string; retentionUntil: string | null; noticeOffered: boolean }> {
  const today = input.today ?? firmTodayKey()
  const settings = await loadFileClosingSettings(admin)
  let closedOn = today
  let until: string | null = null
  try {
    const { data } = await admin.from('matter_details')
      .select('closed_date, retention_until')
      .eq('client_id', input.matterId)
      .maybeSingle()
    const row = data as { closed_date?: string | null; retention_until?: string | null } | null
    closedOn = row?.closed_date ?? today
    until = row?.retention_until ?? retentionUntil(closedOn, settings)
    const update: Record<string, unknown> = {}
    if (!row?.closed_date) update.closed_date = closedOn
    if (!row?.retention_until && until) update.retention_until = until
    if (Object.keys(update).length > 0) {
      let write = await admin.from('matter_details').update(update).eq('client_id', input.matterId)
      if (write.error && write.error.code === '42703' && 'retention_until' in update) {
        // The retention column has not landed; the closed date still must.
        delete update.retention_until
        if (Object.keys(update).length > 0) write = await admin.from('matter_details').update(update).eq('client_id', input.matterId)
      }
      if (write.error) throw new Error(write.error.message)
    }
  } catch (error) {
    console.error('[file closing] could not stamp the closed record', { matterId: input.matterId, cause: error instanceof Error ? error.message : String(error) })
  }

  const noticeOffered = settings.closingNoticeEnabled
  if (noticeOffered) scheduleClosingNotice({ matterId: input.matterId, actorId: input.actor.id })
  return { closedOn, retentionUntil: until, noticeOffered }
}

export interface ClosingNoticeDraft {
  matterId: string
  matterName: string
  clientName: string | null
  to: string
  subject: string
  text: string
  html: string
  hasPortalAccount: boolean
  retentionUntil: string | null
}

/**
 * The closing notice as the record says it today. Composed from the record at
 * both preview and send, so what the attorney approved is what goes out, and
 * a record that changed in between fails the digest check instead of sending.
 * Null when the matter has no client email to write to.
 */
export async function draftClosingNotice(matterId: string, admin: Admin = getAdminClient()): Promise<ClosingNoticeDraft | null> {
  const { data: matter, error } = await admin.from('matters').select('id, name, client_intake_id').eq('id', matterId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!matter) return null
  const intakeId = (matter as { client_intake_id?: string | null }).client_intake_id ?? null
  const [intake, details, firm, settings, annualReviewsOn] = await Promise.all([
    intakeId
      ? admin.from('client_intake').select('email, first_name, full_name, user_id, client_user_id').eq('id', intakeId).maybeSingle().then(result => result.data as { email?: string | null; first_name?: string | null; full_name?: string | null; user_id?: string | null; client_user_id?: string | null } | null)
      : Promise.resolve(null),
    admin.from('matter_details').select('practice_area, plan_type, retention_until, closed_date').eq('client_id', matterId).maybeSingle()
      .then(result => (result.error && !isMissingRelation(result.error) ? null : result.data) as { practice_area?: string | null; plan_type?: string | null; retention_until?: string | null; closed_date?: string | null } | null),
    loadFirmSettings(),
    loadFileClosingSettings(admin),
    annualReviewsEnabledFor(admin, matterId),
  ])
  const to = intake?.email?.trim()
  if (!to) return null
  const hasPortalAccount = Boolean(intake?.user_id || intake?.client_user_id)
  const until = details?.retention_until ?? (details?.closed_date ? retentionUntil(details.closed_date, settings) : null)
  const email = composeClosingNotice({
    firstName: intake?.first_name?.trim() || null,
    firmName: firm.firmName,
    attorneyShortName: firm.attorneyShortName,
    planDescription: describePlan(details?.practice_area ?? null, details?.plan_type ?? null),
    hasPortalAccount,
    portalUrl: hasPortalAccount ? portalUrl('/documents') : null,
    annualReviews: annualReviewsOn,
    retentionYears: settings.retentionYears,
    retentionUntil: until,
  })
  return {
    matterId,
    matterName: (matter as { name: string }).name,
    clientName: intake?.full_name?.trim() || null,
    to,
    ...email,
    hasPortalAccount,
    retentionUntil: until,
  }
}

/**
 * Whether the client will hear from the firm about annual reviews: the
 * campaign is on and this matter has not opted out. Both columns may be
 * absent on a database the campaign has not reached; then the answer is no.
 */
async function annualReviewsEnabledFor(admin: Admin, matterId: string): Promise<boolean> {
  try {
    const firm = await admin.from('firm_settings').select('annual_review_outreach_enabled').eq('id', 1).maybeSingle()
    if (firm.error || (firm.data as { annual_review_outreach_enabled?: boolean } | null)?.annual_review_outreach_enabled !== true) return false
    const details = await admin.from('matter_details').select('annual_review_opt_out').eq('client_id', matterId).maybeSingle()
    if (details.error) return true
    return (details.data as { annual_review_opt_out?: boolean | null } | null)?.annual_review_opt_out !== true
  } catch {
    return false
  }
}

export type NoticeDelegation = 'proposed' | 'sent' | 'observed' | 'duplicate' | 'skipped' | 'failed'

/** Offer the closing notice through the dial. The proposal is created even at Propose: the card is the queue. */
export async function delegateClosingNotice(input: { matterId: string; actorId: string }): Promise<NoticeDelegation> {
  try {
    const draft = await draftClosingNotice(input.matterId)
    if (!draft) return 'skipped'
    const { createActionProposal } = await import('@/lib/actions/server')
    const created = await createActionProposal({
      actionKey: CLOSING_NOTICE_ACTION_KEY,
      displaySummary: closingNoticeSummary(draft.clientName, draft.to),
      referencePayload: { matterId: input.matterId },
      recordType: 'matter',
      recordId: input.matterId,
      source: 'automation',
      // One notice per close. Reopening and closing again is a new day, and a
      // new key, so a matter closed twice can be told twice.
      idempotencyKey: `closing-notice:${input.matterId}:${firmTodayKey()}`,
      applyAutonomy: true,
    }, { id: input.actorId })
    if (created.duplicate) return 'duplicate'
    if (created.autonomy === 'observe') return 'observed'
    if (created.execution) return created.execution.status === 'succeeded' ? 'sent' : 'failed'
    return 'proposed'
  } catch (error) {
    console.error('[file closing] closing notice delegation failed', { matterId: input.matterId, cause: error instanceof Error ? error.message : String(error) })
    return 'failed'
  }
}

/** Queue the notice behind the response that closed the matter, so the close stays quick and nothing here can fail it. */
export function scheduleClosingNotice(input: { matterId: string; actorId: string }): void {
  const run = async () => {
    await delegateClosingNotice(input)
  }
  try {
    after(run)
  } catch {
    // Outside a request scope (tests, scripts) there is no "after"; run inline.
    void run()
  }
}

export interface ClosingNoticeSendResult {
  sent: boolean
  status: 'sent' | 'redirected' | 'suppressed' | 'logged'
  matterId: string
  to: string
  messageId: string | null
}

/** Send the closing notice: the email, the same words in the portal when the client has an account, and the timeline entry. */
export async function sendClosingNotice(args: { admin: Admin; matterId: string; actorId: string }): Promise<ClosingNoticeSendResult> {
  const { admin, matterId, actorId } = args
  const draft = await draftClosingNotice(matterId, admin)
  if (!draft) throw new Error('This matter has no client email to send the closing notice to')
  const firm = await loadFirmSettings()
  const { sendEmail } = await import('@/lib/email/send')
  const result = await sendEmail({
    category: 'matter_closing_notice',
    to: draft.to,
    subject: draft.subject,
    html: draft.html,
    text: draft.text,
    from: `${firm.attorneyShortName} <${firm.email}>`,
    matterId,
    useStoredTemplate: false,
  })
  if (!result.ok) throw new Error(result.error)
  if (result.status === 'suppressed' || result.status === 'logged') {
    return { sent: false, status: result.status, matterId, to: draft.to, messageId: null }
  }

  let messageId: string | null = null
  if (draft.hasPortalAccount) {
    const message = await admin.from('messages')
      .insert({ matter_id: matterId, sender_role: 'attorney', sender_id: actorId, body: draft.text })
      .select('id')
      .single()
    if (message.error) console.error('[file closing] portal message not posted', { matterId, cause: message.error.message })
    else messageId = (message.data as { id: string }).id
  }

  await admin.from('matter_activity').insert({
    matter_id: matterId,
    event_type: 'email_sent',
    actor_id: actorId,
    actor_name: firm.attorneyShortName,
    title: `Closing notice sent: ${draft.subject}`,
    detail: `To ${draft.to} · ${result.status}${messageId ? ' · also posted to the portal' : ''}`,
  })

  return { sent: true, status: result.status, matterId, to: draft.to, messageId }
}

/** Every closed file with what the retention decision needs. Null when the retention columns are not there yet. */
export async function listRetentionCandidates(admin: Admin = getAdminClient()): Promise<RetentionCandidate[] | null> {
  const { data: matters, error } = await admin
    .from('matters')
    .select('id, name, status, stage, client_intake_id, closed_at')
    .eq('relationship_status', 'hired')
    .or('status.in.(closed,archived),stage.eq.closed')
    .limit(2000)
  if (error) throw new Error(error.message)
  const rows = (matters ?? []) as Array<{ id: string; name: string; status: string | null; stage: string | null; client_intake_id: string | null; closed_at: string | null }>
  if (rows.length === 0) return []

  const ids = rows.map(row => row.id)
  const details = new Map<string, { closed_date: string | null; retention_until: string | null; retention_hold: boolean | null; retention_hold_reason: string | null }>()
  for (let i = 0; i < ids.length; i += 200) {
    const slice = ids.slice(i, i + 200)
    const result = await admin.from('matter_details')
      .select('client_id, closed_date, retention_until, retention_hold, retention_hold_reason')
      .in('client_id', slice)
    if (result.error) {
      if (isMissingRelation(result.error)) return null
      throw new Error(result.error.message)
    }
    for (const row of (result.data ?? []) as Array<{ client_id: string; closed_date: string | null; retention_until: string | null; retention_hold: boolean | null; retention_hold_reason: string | null }>) {
      details.set(row.client_id, row)
    }
  }

  const intakeIds = Array.from(new Set(rows.map(row => row.client_intake_id).filter((id): id is string => Boolean(id))))
  const names = new Map<string, string | null>()
  for (let i = 0; i < intakeIds.length; i += 200) {
    const { data } = await admin.from('client_intake').select('id, full_name').in('id', intakeIds.slice(i, i + 200))
    for (const row of (data ?? []) as Array<{ id: string; full_name: string | null }>) names.set(row.id, row.full_name?.trim() || null)
  }

  return rows.map(matter => {
    const detail = details.get(matter.id)
    return {
      matterId: matter.id,
      matterName: matter.name,
      clientName: matter.client_intake_id ? names.get(matter.client_intake_id) ?? null : null,
      status: matter.status,
      stage: matter.stage,
      closedOn: detail?.closed_date ?? (matter.closed_at ? matter.closed_at.slice(0, 10) : null),
      retentionUntil: detail?.retention_until ?? null,
      hold: detail?.retention_hold === true,
      holdReason: detail?.retention_hold_reason ?? null,
    }
  })
}

export interface RetentionOverview {
  today: string
  settings: FileClosingSettings
  unavailable: boolean
  due: RetentionCandidate[]
  held: RetentionCandidate[]
  retained: RetentionCandidate[]
  /** Closed files with no retention date yet (closed before this shipped and never stamped). */
  undated: RetentionCandidate[]
  recentDestructions: Array<{ id: string; matterName: string | null; matterNumber: string | null; reason: string | null; deletedAt: string; deletedByEmail: string | null }>
}

/** The Settings page: who is due, who is held, who is still within the period, and what was destroyed lately. */
export async function fileClosingOverview(input: { today?: string } = {}): Promise<RetentionOverview> {
  const admin = getAdminClient()
  const today = input.today ?? firmTodayKey()
  const settings = await loadFileClosingSettings(admin)
  const candidates = await listRetentionCandidates(admin)
  const deletions = await admin.from('matter_deletions')
    .select('id, matter_name, matter_number, reason, deleted_at, deleted_by_email')
    .order('deleted_at', { ascending: false })
    .limit(10)
  const recentDestructions = deletions.error
    ? []
    : ((deletions.data ?? []) as Array<Record<string, unknown>>).map(row => ({
      id: String(row.id),
      matterName: (row.matter_name as string | null) ?? null,
      matterNumber: (row.matter_number as string | null) ?? null,
      reason: (row.reason as string | null) ?? null,
      deletedAt: String(row.deleted_at),
      deletedByEmail: (row.deleted_by_email as string | null) ?? null,
    }))
  if (candidates === null) {
    return { today, settings, unavailable: true, due: [], held: [], retained: [], undated: [], recentDestructions }
  }
  const selection = selectRetentionReview(candidates, today)
  return {
    today,
    settings,
    unavailable: false,
    due: selection.due,
    held: selection.held,
    retained: selection.retained.filter(candidate => candidate.retentionUntil !== null).slice(0, 100),
    undated: selection.retained.filter(candidate => candidate.retentionUntil === null),
    recentDestructions,
  }
}

export interface RetentionRunResult {
  unavailable: boolean
  today: string
  closedFiles: number
  due: number
  proposed: number
  done: number
  observed: number
  duplicates: number
  failed: number
  /** Closed files that had no retention date and were given one from their closed date. */
  stamped: number
}

/**
 * The weekly run. Gives any closed file still missing its retention date one
 * from the day it closed, then proposes a review task for every file past its
 * date and not on hold. One decision per file per retention date: the
 * idempotency key makes a second Monday a no-op.
 */
export async function prepareRetentionReview(input: { actorId: string | null; today?: string }): Promise<RetentionRunResult> {
  const admin = getAdminClient()
  const today = input.today ?? firmTodayKey()
  const result: RetentionRunResult = { unavailable: false, today, closedFiles: 0, due: 0, proposed: 0, done: 0, observed: 0, duplicates: 0, failed: 0, stamped: 0 }
  const settings = await loadFileClosingSettings(admin)
  const candidates = await listRetentionCandidates(admin)
  if (candidates === null) return { ...result, unavailable: true }
  result.closedFiles = candidates.length

  for (const candidate of candidates) {
    if (candidate.retentionUntil || !candidate.closedOn) continue
    const until = retentionUntil(candidate.closedOn, settings)
    if (!until) continue
    const { error } = await admin.from('matter_details').update({ retention_until: until }).eq('client_id', candidate.matterId)
    if (!error) {
      candidate.retentionUntil = until
      result.stamped += 1
    }
  }

  const { due } = selectRetentionReview(candidates, today)
  result.due = due.length
  if (due.length === 0 || !input.actorId) return result

  const { createActionProposal } = await import('@/lib/actions/server')
  for (const candidate of due) {
    const task = retentionReviewTask(candidate, settings)
    try {
      const created = await createActionProposal({
        actionKey: 'task.create',
        displaySummary: task.title,
        referencePayload: { title: task.title, description: task.description, matter_id: candidate.matterId, priority: 'normal', source: 'automation' },
        recordType: 'matter',
        recordId: candidate.matterId,
        source: 'automation',
        idempotencyKey: `retention:${candidate.matterId}:${candidate.retentionUntil}`,
        applyAutonomy: true,
      }, { id: input.actorId })
      if (created.duplicate) result.duplicates += 1
      else if (created.autonomy === 'observe') result.observed += 1
      else if (created.execution) { if (created.execution.status === 'succeeded') result.done += 1; else result.failed += 1 }
      else result.proposed += 1
    } catch (error) {
      console.error('[file closing] retention review proposal failed', { matterId: candidate.matterId, cause: error instanceof Error ? error.message : String(error) })
      result.failed += 1
    }
  }
  return result
}
