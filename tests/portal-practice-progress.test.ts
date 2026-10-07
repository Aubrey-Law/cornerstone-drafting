import { describe, expect, it } from 'vitest'
import { progressFromMatterDetails } from '@/lib/portal/progress'
describe('recorded portal progress', () => {
  it('keeps probate milestones separate from drafting and does not infer missing work', () => {
    const progress = progressFromMatterDetails({ practice_area: 'Probate', pb_inventory_filed_date: '2026-09-01' })
    expect(progress.heading).toBe('Your probate matter')
    // Petition, appointed, inventory, claims period, distributed, closed: only the
    // inventory date is recorded, and it does not fill the earlier two.
    expect(progress.milestones.map(m => m.state)).toEqual(['pending', 'pending', 'completed', 'pending', 'pending', 'pending'])
    expect(JSON.stringify(progress)).not.toMatch(/draft|two weeks|estate plan/i)
  })
  it('does not mark signing complete from a scheduled signing date', () => {
    const progress = progressFromMatterDetails({ practice_area: 'EP', scheduled_signing_date: '2026-09-12', draft_sent_date: '2026-09-01' })
    expect(progress.milestones.find(m => m.key === 'signing')?.state).toBe('pending')
    expect(progress.milestones.find(m => m.key === 'drafts')?.state).toBe('completed')
  })
  it.each([null, { practice_area: 'unknown' }, { practice_area: 'CP' }])('keeps missing or other tracks neutral: %j', details => {
    expect(progressFromMatterDetails(details).heading).toBe('Your matter')
    expect(progressFromMatterDetails(details).milestones).toEqual([])
  })
})
