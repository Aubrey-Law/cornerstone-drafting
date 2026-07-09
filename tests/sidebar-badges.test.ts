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
    expect(getNavBadge('/admin/drafting', counts)).toEqual({ value: 4, tone: 'accent' })
    expect(getNavBadge('/admin/pipeline/aging', counts)).toEqual({ value: 1, tone: 'destructive' })
    expect(getNavBadge('/admin/calls', counts)).toEqual({ value: 5, tone: 'accent' })
    expect(getNavBadge('/admin/settings', counts)).toBeNull()
  })

  it('prefers aging red over amber', () => {
    const counts = {
      ...EMPTY_SIDEBAR_COUNTS,
      agingRedCount: 0,
      agingAmberCount: 2,
    }
    expect(getNavBadge('/admin/pipeline/aging', counts)).toEqual({ value: 2, tone: 'accent' })
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
    expect(counts).toContain('fetchMatterAgingTiles')
    expect(layout).toContain('/api/admin/sidebar-counts')
    expect(layout).toContain('getNavBadge(item.href, badgeCounts)')
    expect(layout).toContain('SIDEBAR_COUNTS_INVALIDATE_EVENT')
  })
})
