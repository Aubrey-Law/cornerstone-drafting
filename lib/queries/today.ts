import { getAdminClient } from '@/lib/supabaseAdmin'
import { fetchMatterAging, type MatterAgingRow } from '@/lib/queries/pipelineAging'
import { PIPELINE_MATTER_COLUMNS } from '@/lib/queries/matterCore'
import { computeMatterNextAction } from '@/lib/matterNextAction'
import type { PipelineMatter } from '@/types/database'

export interface TodayUnreadThread {
  matter_id: string
  client_name: string | null
  unread_count: number
  latest_at: string | null
}

export interface TodayData {
  /** Red/amber (non-snoozed) aging rows, worst first. */
  atRisk: MatterAgingRow[]
  /** Matters with unread client portal messages, newest first. */
  unreadThreads: TodayUnreadThread[]
  /** Submitted intakes waiting on attorney review. */
  intakeReview: PipelineMatter[]
  /** Matters where the intake questionnaire still needs to be sent. */
  intakeToSend: PipelineMatter[]
  /** Calls not yet linked to a matter. */
  unassignedCallCount: number
  activeMatterCount: number
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
      .is('matter_id', null),
  ])

  if (mattersRes.error) console.error('fetchTodayData matters error:', mattersRes.error)
  if (unreadRes.error) console.error('fetchTodayData unread messages error:', unreadRes.error)
  if (callsRes.error) console.error('fetchTodayData calls error:', callsRes.error)

  const matters = (mattersRes.data ?? []) as PipelineMatter[]
  const matterById = new Map(matters.map(m => [m.matter_id, m]))

  const unreadByMatter = new Map<string, TodayUnreadThread>()
  for (const row of (unreadRes.data ?? []) as Array<{ matter_id: string; created_at: string }>) {
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

  return {
    atRisk: aging.rows.filter(row => !row.is_snoozed && row.health !== 'green'),
    unreadThreads,
    intakeReview,
    intakeToSend,
    unassignedCallCount: callsRes.count ?? 0,
    activeMatterCount: matters.length,
  }
}
