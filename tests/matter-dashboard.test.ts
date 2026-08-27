import { describe, expect, it } from 'vitest'
import {
  QUIET_MATTER_DAYS,
  SIGNING_SOON_DAYS,
  buildMatterDashboard,
  isOpenMatter,
  isSigningSoon,
  needsAttention,
} from '@/lib/matters/dashboard'
import type { MatterListRow } from '@/lib/queries/matters'

const NOW = Date.UTC(2026, 7, 27, 12, 0, 0)
const DAY = 86_400_000
const iso = (offsetDays: number) => new Date(NOW - offsetDays * DAY).toISOString()

function matter(overrides: Record<string, unknown> = {}): MatterListRow {
  return {
    matter_id: 'm1',
    matter_name: 'Estate Plan',
    client_name: 'Jane Smith',
    matter_number: 'EP-1',
    stage: 'intake_review',
    practice_area: 'estate_planning',
    intake_status: 'submitted',
    signing_date: null,
    matter_created: iso(3),
    documents_executed_at: null,
    drafts_sent_at: null,
    intake_submitted_at: null,
    unreviewed_intake_upload_count: 0,
    unreviewed_portal_upload_count: 0,
    ...overrides,
  } as unknown as MatterListRow
}

describe('matter dashboard', () => {
  describe('predicates', () => {
    it('treats a closed-group stage as not open', () => {
      expect(isOpenMatter(matter())).toBe(true)
      expect(isOpenMatter(matter({ stage: 'closed' }))).toBe(false)
    })

    it('flags a matter with uploads nobody has read, however recently it moved', () => {
      const fresh = matter({ matter_created: iso(0), unreviewed_portal_upload_count: 1 })
      expect(needsAttention(fresh, NOW)).toBe(true)
    })

    it('flags a matter only once it is quiet past the threshold', () => {
      expect(needsAttention(matter({ matter_created: iso(QUIET_MATTER_DAYS) }), NOW)).toBe(false)
      expect(needsAttention(matter({ matter_created: iso(QUIET_MATTER_DAYS + 1) }), NOW)).toBe(true)
    })

    it('counts a signing as soon only when it is ahead and inside the window', () => {
      expect(isSigningSoon(matter({ signing_date: iso(-1) }), NOW)).toBe(true)
      expect(isSigningSoon(matter({ signing_date: iso(-SIGNING_SOON_DAYS) }), NOW)).toBe(true)
      expect(isSigningSoon(matter({ signing_date: iso(-SIGNING_SOON_DAYS - 1) }), NOW)).toBe(false)
      // Already passed — that is not upcoming work.
      expect(isSigningSoon(matter({ signing_date: iso(1) }), NOW)).toBe(false)
      expect(isSigningSoon(matter({ signing_date: null }), NOW)).toBe(false)
    })
  })

  describe('snapshot', () => {
    it('counts only open matters in the headline totals', () => {
      const snapshot = buildMatterDashboard(
        [matter({ matter_id: 'a' }), matter({ matter_id: 'b', stage: 'closed' })],
        NOW,
      )
      expect(snapshot.open.count).toBe(1)
    })

    it('lists every stage group including the empty ones', () => {
      const snapshot = buildMatterDashboard([matter()], NOW)
      // A bar with a visible gap says something a bar that omits the gap does not.
      expect(snapshot.stages.length).toBeGreaterThan(1)
      expect(snapshot.stages.some(s => s.count === 0)).toBe(true)
      expect(snapshot.stages.every(s => s.key !== 'closed')).toBe(true)
    })

    it('reports no delta rather than a fake one when there is no prior month', () => {
      const snapshot = buildMatterDashboard([matter({ matter_created: iso(1) })], NOW)
      expect(snapshot.open.deltaPercent).toBeNull()
      expect(snapshot.open.newThisMonth).toBe(1)
    })

    it('computes a delta once both months have matters', () => {
      const snapshot = buildMatterDashboard(
        [
          matter({ matter_id: 'a', matter_created: iso(1) }),
          matter({ matter_id: 'b', matter_created: iso(2) }),
          // Roughly 45 days back lands in the prior month.
          matter({ matter_id: 'c', matter_created: iso(45) }),
        ],
        NOW,
      )
      expect(snapshot.open.newThisMonth).toBe(2)
      expect(snapshot.open.newPriorMonth).toBe(1)
      expect(snapshot.open.deltaPercent).toBe(100)
    })

    it('sorts practice areas by size and labels a missing one', () => {
      const snapshot = buildMatterDashboard(
        [
          matter({ matter_id: 'a', practice_area: 'estate_planning' }),
          matter({ matter_id: 'b', practice_area: 'estate_planning' }),
          matter({ matter_id: 'c', practice_area: null }),
        ],
        NOW,
      )
      expect(snapshot.practiceAreas[0].count).toBe(2)
      expect(snapshot.practiceAreas.at(-1)?.label).toBe('Unassigned')
    })

    it('orders recent matters by their newest milestone, not by creation', () => {
      const snapshot = buildMatterDashboard(
        [
          matter({ matter_id: 'old-but-active', matter_created: iso(90), drafts_sent_at: iso(1) }),
          matter({ matter_id: 'new-but-idle', matter_created: iso(5) }),
        ],
        NOW,
      )
      expect(snapshot.recent[0].matter_id).toBe('old-but-active')
    })

    it('survives an empty book without dividing by zero', () => {
      const snapshot = buildMatterDashboard([], NOW)
      expect(snapshot.open.count).toBe(0)
      expect(snapshot.stages.every(s => s.percent === 0)).toBe(true)
      expect(snapshot.recent).toEqual([])
    })
  })
})
