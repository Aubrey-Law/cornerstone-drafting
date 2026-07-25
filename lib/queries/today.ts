import { getAdminClient } from '@/lib/supabaseAdmin'
import { fetchMatterAging, type MatterAgingRow } from '@/lib/queries/pipelineAging'
import { PIPELINE_MATTER_COLUMNS } from '@/lib/queries/matterCore'
import { computeMatterNextAction, type MatterNextActionKind } from '@/lib/matterNextAction'
import { firmDateKey, firmTodayKey } from '@/lib/firmDate'
import type { PipelineMatter } from '@/types/database'

export interface TodayUnreadThread {
  matter_id: string
  client_name: string | null
  unread_count: number
  latest_at: string | null
}

/** Serializable per-row primary action for the Today queue. */
export interface TodayQueueAction {
  kind: MatterNextActionKind
  label: string
  href: string
}

/** Aging row decorated with everything the queue needs to act inline. */
export interface TodayQueueRow extends MatterAgingRow {
  action: TodayQueueAction | null
  /** Set when the row can be nudged inline by resending the intake invite. */
  nudge_matter_id: string | null
}

export interface TodayAppointment {
  matter_id: string
  client_name: string | null
  next_appointment: string
  next_appointment_type: string | null
}

export interface TodayData {
  /** Red/amber (non-snoozed) aging rows, worst first. */
  atRisk: MatterAgingRow[]
  /** At-risk rows where the ball is in the attorney's court. */
  waitingOnYou: TodayQueueRow[]
  /** At-risk rows waiting on the client. */
  waitingOnClient: TodayQueueRow[]
  /** Snoozed aging rows, so Today can wake them without the aging board. */
  snoozed: TodayQueueRow[]
  /** Matters with unread client portal messages, newest first. Live matters only. */
  unreadThreads: TodayUnreadThread[]
  /** Submitted intakes waiting on attorney review. */
  intakeReview: PipelineMatter[]
  /** Matters where the intake questionnaire still needs to be sent. */
  intakeToSend: PipelineMatter[]
  /** Matters with an appointment today (firm timezone), soonest first. */
  appointmentsToday: TodayAppointment[]
  /** Calls not yet linked to a lead or matter. */
  unassignedCallCount: number
  activeMatterCount: number
  /** Rows the attorney can act on — never counts client-owned aging rows. */
  needsYou: number
  /** Non-snoozed rows with red health. */
  overdueCount: number
}

const ACTION_LABEL: Record<MatterNextActionKind, string> = {
  'send-intake': 'Send intake',
  'review-intake': 'Review',
  'draft': 'Draft',
  'send-engagement': 'Send engagement',
  'waiting-intake': 'Resend',
  'waiting-engagement': 'Resend',
  'resolve-review-flags': 'Review flags',
}

function decorateRow(row: MatterAgingRow, matterById: Map<string, PipelineMatter>): TodayQueueRow {
  const matter = row.entity === 'matter' ? matterById.get(row.id) : undefined
  if (!matter) return { ...row, action: null, nudge_matter_id: null }
  const next = computeMatterNextAction(matter)
  return {
    ...row,
    action: { kind: next.kind, label: ACTION_LABEL[next.kind] ?? next.cta, href: next.href },
    nudge_matter_id: next.kind === 'waiting-intake' ? matter.matter_id : null,
  }
}

/**
 * One aggregate read for the attorney's "Today" home page. Reuses the same
 * sources as the sidebar badges but returns actionable rows, not just counts.
 */
export async function fetchTodayData(): Promise<TodayData> {
  const admin = getAdminClient()

  const [aging, mattersRes, unreadRes, callsRes] = await Promise.all([
    fetchMatterAging(),
    admin
      .from('v_matter_pipeline')
      .select(PIPELINE_MATTER_COLUMNS)
      .neq('status', 'archived')
      .neq('stage', 'closed')
      .order('matter_created', { ascending: false }),
    admin
      .from('messages')
      .select('matter_id, created_at')
      .eq('sender_role', 'client')
      .is('read_at', null),
    admin
      .from('calls')
      .select('id', { count: 'exact', head: true })
      .is('matter_id', null)
      .is('lead_id', null),
  ])

  if (mattersRes.error) console.error('fetchTodayData matters error:', mattersRes.error)
  if (unreadRes.error) console.error('fetchTodayData unread messages error:', unreadRes.error)
  if (callsRes.error) console.error('fetchTodayData calls error:', callsRes.error)

  const matters = (mattersRes.data ?? []) as PipelineMatter[]
  const matterById = new Map(matters.map(m => [m.matter_id, m]))

  const unreadByMatter = new Map<string, TodayUnreadThread>()
  for (const row of (unreadRes.data ?? []) as Array<{ matter_id: string; created_at: string }>) {
    // Only live matters — unread messages on archived/closed matters would
    // otherwise render as "Unnamed matter" linking into a closed matter.
    if (!matterById.has(row.matter_id)) continue
    const current = unreadByMatter.get(row.matter_id)
    if (current) {
      current.unread_count += 1
      if (!current.latest_at || row.created_at > current.latest_at) current.latest_at = row.created_at
    } else {
      unreadByMatter.set(row.matter_id, {
        matter_id: row.matter_id,
        client_name: matterById.get(row.matter_id)?.client_name ?? null,
        unread_count: 1,
        latest_at: row.created_at,
      })
    }
  }
  const unreadThreads = [...unreadByMatter.values()].sort((a, b) =>
    (b.latest_at ?? '').localeCompare(a.latest_at ?? ''),
  )

  const intakeReview = matters.filter(m => m.stage === 'intake_review')
  const intakeToSend = matters.filter(m => computeMatterNextAction(m).kind === 'send-intake')

  const atRisk = aging.rows.filter(row => !row.is_snoozed && row.health !== 'green')
  const waitingOnYou = atRisk.filter(r => r.owner !== 'client').map(r => decorateRow(r, matterById))
  const waitingOnClient = atRisk.filter(r => r.owner === 'client').map(r => decorateRow(r, matterById))
  const snoozed = aging.rows.filter(r => r.is_snoozed).map(r => decorateRow(r, matterById))

  const todayKey = firmTodayKey()
  const appointmentsToday = matters
    .filter(m => m.next_appointment && firmDateKey(m.next_appointment) === todayKey)
    .map(m => ({
      matter_id: m.matter_id,
      client_name: m.client_name ?? null,
      next_appointment: m.next_appointment as string,
      next_appointment_type: m.next_appointment_type ?? null,
    }))
    .sort((a, b) => a.next_appointment.localeCompare(b.next_appointment))

  return {
    atRisk,
    waitingOnYou,
    waitingOnClient,
    snoozed,
    unreadThreads,
    intakeReview,
    intakeToSend,
    appointmentsToday,
    unassignedCallCount: callsRes.count ?? 0,
    activeMatterCount: matters.length,
    needsYou:
      waitingOnYou.length + unreadThreads.length + intakeReview.length + intakeToSend.length,
    overdueCount: atRisk.filter(r => r.health === 'red').length,
  }
}
