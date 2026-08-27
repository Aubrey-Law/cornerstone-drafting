import { getAdminClient } from '@/lib/supabaseAdmin'

/**
 * The matters the sidebar shows: the ones this user pinned, plus the ones that
 * moved most recently.
 *
 * This deliberately does not reuse `fetchMattersList()`. That reads the whole
 * book and joins matter numbers and upload counts for every row — fine for the
 * matters page, far too much for a query that runs on every admin page load.
 * Here we read a handful of columns with an explicit limit.
 */

export const SIDEBAR_RECENT_LIMIT = 5

export interface MatterNavRow {
  matter_id: string
  title: string
  client_name: string | null
  matter_number: string | null
  /** Newest of the four milestone timestamps; null when none has been reached. */
  last_milestone_at: string | null
}

interface PipelineNavRow {
  matter_id: string
  matter_name: string | null
  client_name: string | null
  documents_executed_at: string | null
  drafts_sent_at: string | null
  intake_submitted_at: string | null
  matter_created: string | null
}

const NAV_COLUMNS =
  'matter_id, matter_name, client_name, documents_executed_at, drafts_sent_at, intake_submitted_at, matter_created'

function milestoneAt(row: PipelineNavRow): string | null {
  const candidates = [
    row.documents_executed_at,
    row.drafts_sent_at,
    row.intake_submitted_at,
    row.matter_created,
  ].filter((value): value is string => Boolean(value))
  if (candidates.length === 0) return null
  return candidates.reduce((newest, value) => (value > newest ? value : newest))
}

function toNavRow(row: PipelineNavRow, matterNumber: string | null): MatterNavRow {
  return {
    matter_id: row.matter_id,
    title: row.client_name || row.matter_name || 'Untitled',
    client_name: row.client_name,
    matter_number: matterNumber,
    last_milestone_at: milestoneAt(row),
  }
}

export interface SidebarMatters {
  pinned: MatterNavRow[]
  recent: MatterNavRow[]
  error: string | null
}

export async function fetchSidebarMatters(
  pinnedIds: string[],
  activeMatterId?: string | null,
): Promise<SidebarMatters> {
  const admin = getAdminClient()

  // Over-fetch the recents so the pinned ones can be filtered out without a
  // second round trip and still leave a full list.
  const recentQuery = admin
    .from('v_matter_pipeline')
    .select(NAV_COLUMNS)
    .neq('status', 'archived')
    .order('matter_created', { ascending: false })
    .limit(SIDEBAR_RECENT_LIMIT + pinnedIds.length + 10)

  const pinnedQuery = pinnedIds.length
    ? admin.from('v_matter_pipeline').select(NAV_COLUMNS).in('matter_id', pinnedIds)
    : null

  const [recentRes, pinnedRes] = await Promise.all([
    recentQuery,
    pinnedQuery ?? Promise.resolve({ data: [] as PipelineNavRow[], error: null }),
  ])

  if (recentRes.error) {
    console.error('fetchSidebarMatters recent error:', recentRes.error)
    return { pinned: [], recent: [], error: recentRes.error.message }
  }
  if (pinnedRes.error) {
    // A failed pinned read should not cost the user their recents.
    console.error('fetchSidebarMatters pinned error:', pinnedRes.error)
  }

  const recentRows = (recentRes.data ?? []) as unknown as PipelineNavRow[]
  const pinnedRows = (pinnedRes.data ?? []) as unknown as PipelineNavRow[]

  const ids = [...new Set([...recentRows, ...pinnedRows].map(row => row.matter_id))]
  const numbersRes = ids.length
    ? await admin.from('matters').select('id, matter_number').in('id', ids)
    : { data: [] as { id: string; matter_number: string | null }[], error: null }
  if (numbersRes.error) console.error('fetchSidebarMatters matter numbers error:', numbersRes.error)
  const numberById = new Map(
    (numbersRes.data ?? []).map(row => [row.id, row.matter_number] as const),
  )

  const pinnedById = new Map(pinnedRows.map(row => [row.matter_id, row] as const))
  // Ordered by the stored list, not by the query — the user chose this order. A
  // pinned matter that has since been deleted simply drops out.
  const pinned = pinnedIds
    .map(id => pinnedById.get(id))
    .filter((row): row is PipelineNavRow => row !== undefined)
    .map(row => toNavRow(row, numberById.get(row.matter_id) ?? null))

  const pinnedIdSet = new Set(pinnedIds)
  const ranked = recentRows
    .filter(row => !pinnedIdSet.has(row.matter_id))
    .map(row => toNavRow(row, numberById.get(row.matter_id) ?? null))
    .sort((a, b) => (b.last_milestone_at ?? '').localeCompare(a.last_milestone_at ?? ''))

  const recent = ranked.slice(0, SIDEBAR_RECENT_LIMIT)

  /**
   * The matter being viewed stays reachable even when it is too old to rank.
   *
   * It is appended rather than promoted to the top: sorting the open matter to
   * the front means every click yanks the row you just clicked upwards, and the
   * list moves under the cursor.
   */
  if (activeMatterId && !pinnedIdSet.has(activeMatterId)) {
    const alreadyShown = recent.some(row => row.matter_id === activeMatterId)
    if (!alreadyShown) {
      const active = ranked.find(row => row.matter_id === activeMatterId)
      if (active) {
        if (recent.length >= SIDEBAR_RECENT_LIMIT) recent.pop()
        recent.push(active)
      }
    }
  }

  return { pinned, recent, error: null }
}
