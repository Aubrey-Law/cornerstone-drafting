import { expect, it } from 'vitest'
import { nextMatterMilestone } from '@/lib/matter/nextMilestone'
import type { PipelineMatter } from '@/types/database'
const matter = { stage: 'drafting', status: 'active' } as PipelineMatter
it('prioritizes the earliest unfinished overdue milestone', () => {
  expect(nextMatterMilestone(matter, { design_meeting_date: '2026-09-01', scheduled_signing_date: '2026-10-20' }, '2026-10-07'))
    .toMatchObject({ label: 'Drafts due', date: '2026-10-02', daysAway: -5, derived: true })
})
it('retires earlier milestones as the matter progresses', () => {
  expect(nextMatterMilestone({ ...matter, stage: 'signing_scheduled' }, { scheduled_signing_date: '2026-10-20', client_review_date: '2026-09-20' }, '2026-10-07'))
    .toMatchObject({ label: 'Target signing', daysAway: 13 })
})
it('treats actual signing and engagement dates as history', () => {
  expect(nextMatterMilestone(matter, { signing_date: '2026-10-01', scheduled_signing_date: '2026-09-30', engagement_signed_at: '2026-08-01' }, '2026-10-07')).toBeNull()
})
it('handles empty and closed matters without invented dates', () => {
  expect(nextMatterMilestone(matter, null, '2026-10-07')).toBeNull()
  expect(nextMatterMilestone({ ...matter, stage: 'closed' }, { next_action_date: '2026-10-09' }, '2026-10-07')).toBeNull()
})
