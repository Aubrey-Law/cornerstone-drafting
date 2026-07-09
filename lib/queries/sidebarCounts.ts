import { getAdminClient } from '@/lib/supabaseAdmin'
import { fetchMatterAgingTiles } from '@/lib/queries/pipelineAging'
import { type SidebarCounts } from '@/lib/sidebarBadges'

interface CountResult {
  count: number | null
  error: { message: string } | null
}

function countOrZero(result: CountResult, label: string): number {
  if (result.error) {
    console.error(`sidebar counts ${label} error:`, result.error)
    return 0
  }
  return result.count ?? 0
}

export async function fetchSidebarCounts(): Promise<SidebarCounts> {
  const admin = getAdminClient()

  const [intakeReview, unassignedCalls, openMattersRes] = await Promise.all([
    admin
      .from('v_matter_pipeline')
      .select('matter_id', { count: 'exact', head: true })
      .eq('stage', 'intake_review'),
    admin
      .from('calls')
      .select('id', { count: 'exact', head: true })
      .is('matter_id', null),
    admin
      .from('v_matter_pipeline')
      .select('matter_id')
      .neq('stage', 'closed'),
  ])

  const intakeReviewCount = countOrZero(intakeReview, 'intake review')
  const unassignedCallsCount = countOrZero(unassignedCalls, 'unassigned calls')

  let draftingNeedsDesignCount = 0
  const openMatterIds = ((openMattersRes.data ?? []) as Array<{ matter_id: string }>).map(row => row.matter_id)
  if (openMattersRes.error) {
    console.error('sidebar counts open matters error:', openMattersRes.error)
  } else if (openMatterIds.length > 0) {
    const { data: designSheets, error: designSheetsError } = await admin
      .from('design_sheets')
      .select('matter_id')
      .in('matter_id', openMatterIds)

    if (designSheetsError) {
      console.error('sidebar counts design sheets error:', designSheetsError)
    } else {
      const mattersWithDesign = new Set(
        ((designSheets ?? []) as Array<{ matter_id: string }>).map(row => row.matter_id),
      )
      draftingNeedsDesignCount = openMatterIds.filter(id => !mattersWithDesign.has(id)).length
    }
  }

  let agingRedCount = 0
  let agingAmberCount = 0
  try {
    const tiles = await fetchMatterAgingTiles()
    agingRedCount = tiles.red
    agingAmberCount = tiles.amber
  } catch (error) {
    console.error('sidebar counts aging error:', error)
  }

  return {
    intakeReviewCount,
    draftingNeedsDesignCount,
    agingRedCount,
    agingAmberCount,
    unassignedCallsCount,
  }
}
