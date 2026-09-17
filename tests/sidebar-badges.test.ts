import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { EMPTY_SIDEBAR_COUNTS, getNavBadge, mergeSidebarCounts } from '@/lib/sidebarBadges'

describe('sidebar badges', () => {
  it('maps lite admin nav routes to attention counts', () => {
    const counts = {
      ...EMPTY_SIDEBAR_COUNTS,
      intakeReviewCount: 2,
      draftingNeedsDesignCount: 4,
      agingRedCount: 1,
      agingAmberCount: 3,
      inboxNeedsReplyCount: 5,
    }

    expect(getNavBadge('/admin/matters', counts)).toEqual({ value: 2, tone: 'destructive' })
    // Aging is folded into Drafting: overdue (red) takes priority on that badge.
    expect(getNavBadge('/admin/drafting', counts)).toEqual({ value: 1, tone: 'destructive' })
    expect(getNavBadge('/admin', counts)).toEqual({ value: 5, tone: 'accent' })
    expect(getNavBadge('/admin/settings', counts)).toBeNull()
  })

  it('does not present failed refreshes as current badges', () => {
    // It used to hide them, which reads as "nothing needs your attention" —
    // the one meaning a badge must never carry by accident. The last known
    // count is shown and marked instead.
    expect(getNavBadge('/admin/billing', { ...EMPTY_SIDEBAR_COUNTS, overdueInvoiceCount: 3, errors: ['overdueInvoiceCount'] }))
      .toEqual({ value: 3, tone: 'destructive', stale: true })
    expect(getNavBadge('/admin/inbox', { ...EMPTY_SIDEBAR_COUNTS, inboxNeedsReplyCount: 2 })).toBeNull()
  })

  it('shows nothing when a category failed before it ever loaded', () => {
    // There is no last known count to show, and inventing one is worse than
    // showing nothing.
    expect(getNavBadge('/admin/billing', { ...EMPTY_SIDEBAR_COUNTS, errors: ['overdueInvoiceCount'] })).toBeNull()
  })

  it('marks only the categories that actually failed', () => {
    const counts = {
      ...EMPTY_SIDEBAR_COUNTS,
      tasksOverdueCount: 4,
      overdueInvoiceCount: 3,
      errors: ['tasksOverdueCount'],
    }
    expect(getNavBadge('/admin/tasks', counts)).toEqual({ value: 4, tone: 'destructive', stale: true })
    expect(getNavBadge('/admin/billing', counts)).toEqual({ value: 3, tone: 'destructive' })
  })

  it('carries one failing section across both counts it feeds', () => {
    // `aging` is a single section behind agingRedCount and agingAmberCount.
    expect(getNavBadge('/admin/drafting', { ...EMPTY_SIDEBAR_COUNTS, agingRedCount: 2, errors: ['aging'] }))
      .toEqual({ value: 2, tone: 'destructive', stale: true })
  })

  describe('mergeSidebarCounts', () => {
    const loaded = { ...EMPTY_SIDEBAR_COUNTS, tasksOverdueCount: 4, overdueInvoiceCount: 3 }

    it('keeps the last good value when a section fails', () => {
      // The bug this fixes: a failed section is not missing from the response,
      // it carries the server's fallback of 0 — and `?? prev` does not fall
      // back on a zero, so the good value was being overwritten with "none".
      const merged = mergeSidebarCounts(loaded, {
        ...EMPTY_SIDEBAR_COUNTS,
        overdueInvoiceCount: 5,
        errors: ['tasksOverdueCount'],
      })
      expect(merged.tasksOverdueCount).toBe(4)
      expect(merged.overdueInvoiceCount).toBe(5)
      expect(merged.errors).toEqual(['tasksOverdueCount'])
    })

    it('accepts a real zero from a section that answered', () => {
      // The last task was completed; the badge must clear.
      const merged = mergeSidebarCounts(loaded, { ...EMPTY_SIDEBAR_COUNTS, overdueInvoiceCount: 3 })
      expect(merged.tasksOverdueCount).toBe(0)
      expect(getNavBadge('/admin/tasks', merged)).toBeNull()
    })

    it('holds both aging counts through one failing section', () => {
      const withAging = { ...EMPTY_SIDEBAR_COUNTS, agingRedCount: 2, agingAmberCount: 6 }
      const merged = mergeSidebarCounts(withAging, { ...EMPTY_SIDEBAR_COUNTS, errors: ['aging'] })
      expect(merged.agingRedCount).toBe(2)
      expect(merged.agingAmberCount).toBe(6)
    })

    it('clears the stale mark once the section answers again', () => {
      const failed = mergeSidebarCounts(loaded, { ...EMPTY_SIDEBAR_COUNTS, errors: ['tasksOverdueCount'] })
      expect(getNavBadge('/admin/tasks', failed)?.stale).toBe(true)

      const recovered = mergeSidebarCounts(failed, { ...EMPTY_SIDEBAR_COUNTS, tasksOverdueCount: 7 })
      expect(getNavBadge('/admin/tasks', recovered)).toEqual({ value: 7, tone: 'destructive' })
    })

    it('leaves the counts alone when there is no response at all', () => {
      expect(mergeSidebarCounts(loaded, null)).toBe(loaded)
    })
  })

  it('badges Billing when an invoice is past due', () => {
    // Late money carries the same urgency as an overdue task, so it is
    // destructive rather than accent.
    expect(getNavBadge('/admin/billing', { ...EMPTY_SIDEBAR_COUNTS, overdueInvoiceCount: 3 }))
      .toEqual({ value: 3, tone: 'destructive' })
  })

  it('leaves Billing unbadged when nothing is late', () => {
    expect(getNavBadge('/admin/billing', EMPTY_SIDEBAR_COUNTS)).toBeNull()
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
    // The shell fetches the counts; the sidebar it renders attaches them to nav
    // items. They were one file until the sidebar was extracted so the desktop
    // column and the mobile sheet could stop duplicating it.
    const sidebar = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/components/AdminSidebar.tsx'),
      'utf8',
    )

    expect(route).toContain("tags: [SIDEBAR_COUNTS_TAG]")
    expect(route).toContain('fetchSidebarCounts')
    expect(counts).toContain("eq('stage', 'intake_review')")
    expect(counts).toContain('fetchMatterAgingTiles')
    expect(layout).toContain('/api/admin/sidebar-counts')
    expect(sidebar).toContain('getNavBadge(item.href, badgeCounts)')
    expect(layout).toContain('@/lib/sidebarCountsClient')
    expect(layout).not.toContain('@/lib/sidebarCountsInvalidation')
  })
})
