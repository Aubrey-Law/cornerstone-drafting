import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { EMPTY_SIDEBAR_COUNTS, getNavBadge } from '@/lib/sidebarBadges'

describe('sidebar badges', () => {
  it('maps lite admin nav routes to attention counts', () => {
    const counts = {
      ...EMPTY_SIDEBAR_COUNTS,
      intakeReviewCount: 2,
      draftingNeedsDesignCount: 4,
      agingRedCount: 1,
      agingAmberCount: 3,
      unassignedCallsCount: 5,
    }

    expect(getNavBadge('/admin/matters', counts)).toEqual({ value: 2, tone: 'destructive' })
    // Aging is folded into Drafting: overdue (red) takes priority on that badge.
    expect(getNavBadge('/admin/drafting', counts)).toEqual({ value: 1, tone: 'destructive' })
    expect(getNavBadge('/admin/calls', counts)).toEqual({ value: 5, tone: 'accent' })
    expect(getNavBadge('/admin/settings', counts)).toBeNull()
  })

  it('falls back from aging red to needs-design, then aging amber on the drafting badge', () => {
    expect(getNavBadge('/admin/drafting', {
      ...EMPTY_SIDEBAR_COUNTS,
      draftingNeedsDesignCount: 4,
      agingAmberCount: 2,
    })).toEqual({ value: 4, tone: 'accent' })
    expect(getNavBadge('/admin/drafting', {
      ...EMPTY_SIDEBAR_COUNTS,
      agingAmberCount: 2,
    })).toEqual({ value: 2, tone: 'accent' })
  })

  it('exposes a cached sidebar counts API for the admin shell', () => {
    const route = fs.readFileSync(
      path.join(process.cwd(), 'app/api/admin/sidebar-counts/route.ts'),
      'utf8',
    )
    const layout = fs.readFileSync(path.join(process.cwd(), 'app/admin/AdminLayoutClient.tsx'), 'utf8')
    const counts = fs.readFileSync(path.join(process.cwd(), 'lib/queries/sidebarCounts.ts'), 'utf8')

    expect(route).toContain("tags: [SIDEBAR_COUNTS_TAG]")
    expect(route).toContain('fetchSidebarCounts')
    expect(counts).toContain("eq('stage', 'intake_review')")
    expect(counts).toContain("is('matter_id', null)")
    expect(counts).toContain("is('lead_id', null)")
    expect(counts).toContain('fetchMatterAgingTiles')
    expect(layout).toContain('/api/admin/sidebar-counts')
    expect(layout).toContain('getNavBadge(item.href, badgeCounts)')
    expect(layout).toContain('@/lib/sidebarCountsClient')
    expect(layout).not.toContain('@/lib/sidebarCountsInvalidation')
  })
})
