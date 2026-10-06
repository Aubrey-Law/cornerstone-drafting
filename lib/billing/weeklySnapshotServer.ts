import 'server-only'

import { ADMIN_EMAIL, getAdminClient } from '@/lib/supabaseAdmin'
import { clearFirmSettingsCache, loadFirmSettings } from '@/lib/firmSettings'
import { firmTodayKey } from '@/lib/firmDate'
import { appUrl } from '@/lib/urls'
import { fetchBillingData } from '@/lib/queries/billing'
import {
  buildWeeklyFinancialSnapshot,
  composeSnapshotEmail,
  lastCompleteWeek,
  rowToSnapshot,
  snapshotToRow,
  type StoredWeeklySnapshot,
  type WeeklyFinancialSnapshot,
} from '@/lib/billing/weeklySnapshot'

/**
 * The weekly financial snapshot: the half that touches records. Reads the
 * ledger through the same loader the Billing page uses, stores the week's
 * row, compares it with the week before, and emails the firm. Tolerates a
 * database the migration has not reached yet.
 */

type Admin = ReturnType<typeof getAdminClient>

/** No staff user is needed for the figures; the loader wants an id only for nudge dismissals. */
const NO_USER = '00000000-0000-0000-0000-000000000000'

function isMissingRelation(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  if (error.code === '42P01' || error.code === 'PGRST205' || error.code === '42703' || error.code === 'PGRST204') return true
  return /does not exist|could not find/i.test(error.message ?? '')
}

export async function fetchStoredSnapshot(admin: Admin, weekStart: string): Promise<StoredWeeklySnapshot | null> {
  const { data, error } = await admin.from('billing_weekly_snapshots').select('*').eq('week_start', weekStart).maybeSingle()
  if (error) {
    if (isMissingRelation(error)) return null
    throw new Error(error.message)
  }
  return data ? rowToSnapshot(data as Record<string, unknown>) : null
}

/** Newest first. Null when the table is not there yet. */
export async function listWeeklySnapshots(limit = 8, admin: Admin = getAdminClient()): Promise<StoredWeeklySnapshot[] | null> {
  const { data, error } = await admin.from('billing_weekly_snapshots').select('*').order('week_start', { ascending: false }).limit(limit)
  if (error) {
    if (isMissingRelation(error)) return null
    throw new Error(error.message)
  }
  return ((data ?? []) as Record<string, unknown>[]).map(rowToSnapshot)
}

export async function loadAnnualGoalCents(admin: Admin = getAdminClient()): Promise<number> {
  const { data } = await admin.from('firm_settings').select('billing_annual_goal_cents').eq('id', 1).maybeSingle()
  const goal = Number((data as { billing_annual_goal_cents?: number } | null)?.billing_annual_goal_cents)
  return Number.isSafeInteger(goal) && goal > 0 ? goal : 12_000_000
}

export async function updateAnnualGoalCents(cents: number, admin: Admin = getAdminClient()): Promise<number> {
  const { error } = await admin.from('firm_settings').update({ billing_annual_goal_cents: cents }).eq('id', 1)
  if (error) throw new Error(error.message)
  clearFirmSettingsCache()
  return loadAnnualGoalCents(admin)
}

export interface SnapshotRunResult {
  ok: boolean
  /** True when the snapshot table is not in the database yet; nothing was stored or sent. */
  unavailable: boolean
  weekStart: string
  weekEnd: string
  stored: boolean
  sent: boolean
  emailStatus: string | null
  error: string | null
  snapshot: WeeklyFinancialSnapshot | null
}

/**
 * The Monday run. Computes the week just ended, stores it (an update when the
 * row exists), and emails the firm once per week: a row that already carries
 * `sent_at` is refreshed but not re-sent, so a re-run never doubles the mail.
 * `force` re-sends anyway, for the "Send now" button.
 */
export async function runWeeklyFinancialSnapshot(input: { today?: string; send?: boolean; force?: boolean } = {}): Promise<SnapshotRunResult> {
  const admin = getAdminClient()
  const today = input.today ?? firmTodayKey()
  const window = lastCompleteWeek(today)
  const result: SnapshotRunResult = {
    ok: false, unavailable: false, weekStart: window.weekStart, weekEnd: window.weekEnd,
    stored: false, sent: false, emailStatus: null, error: null, snapshot: null,
  }

  const data = await fetchBillingData({ userId: NO_USER, selectedMonth: today.slice(0, 7) })
  if (data.error) return { ...result, error: data.error }
  const items = data.snapshot.rows
  const payments = items.flatMap(row => row.payments)
  const snapshot = buildWeeklyFinancialSnapshot({ items, payments, window, annualGoalCents: data.snapshot.annualGoalCents })
  result.snapshot = snapshot

  let previous: StoredWeeklySnapshot | null = null
  try {
    previous = await fetchStoredSnapshot(admin, window.previousWeekStart)
  } catch (error) {
    console.error('[weekly snapshot] could not read the week before', { cause: error instanceof Error ? error.message : String(error) })
  }

  const existing = await admin.from('billing_weekly_snapshots').select('id, sent_at').eq('week_start', window.weekStart).maybeSingle()
  if (existing.error && isMissingRelation(existing.error)) return { ...result, unavailable: true }
  if (existing.error) return { ...result, error: existing.error.message }

  const upsert = await admin.from('billing_weekly_snapshots')
    .upsert(snapshotToRow(snapshot), { onConflict: 'week_start' })
    .select('id, sent_at')
    .single()
  if (upsert.error) return { ...result, error: upsert.error.message }
  result.stored = true
  const row = upsert.data as { id: string; sent_at: string | null }

  const shouldSend = input.send !== false && (input.force === true || !row.sent_at)
  if (!shouldSend) return { ...result, ok: true, sent: false, emailStatus: row.sent_at ? 'already sent' : null }

  const firm = await loadFirmSettings()
  const email = composeSnapshotEmail({ snapshot, previous, window, firmName: firm.firmName, billingUrl: appUrl('/admin/billing?tab=insights') })
  const { sendEmail } = await import('@/lib/email/send')
  const outcome = await sendEmail({
    category: 'weekly_financial_snapshot',
    to: ADMIN_EMAIL,
    subject: email.subject,
    html: email.html,
    text: email.text,
    useStoredTemplate: false,
  })
  const emailStatus = outcome.ok ? outcome.status : 'error'
  await admin.from('billing_weekly_snapshots')
    .update({ email_status: emailStatus, sent_at: outcome.ok && outcome.status !== 'suppressed' && outcome.status !== 'logged' ? new Date().toISOString() : row.sent_at, updated_at: new Date().toISOString() })
    .eq('id', row.id)
  return {
    ...result,
    ok: outcome.ok,
    sent: outcome.ok && (outcome.status === 'sent' || outcome.status === 'redirected'),
    emailStatus,
    error: outcome.ok ? null : outcome.error,
  }
}
