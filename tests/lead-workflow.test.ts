import { describe, expect, it } from 'vitest'
import { canDeleteLeadActivity, mergeLeadAndMatterActivity } from '@/lib/leads/activity'

describe('lead activity', () => {
  it('allows only the note author or an admin to delete a note', () => {
    expect(canDeleteLeadActivity({ eventType: 'note', actorId: 'u1' }, { id: 'u1', role: 'attorney' })).toBe(true)
    expect(canDeleteLeadActivity({ eventType: 'note', actorId: 'u1' }, { id: 'u2', role: 'admin' })).toBe(true)
    expect(canDeleteLeadActivity({ eventType: 'note', actorId: 'u1' }, { id: 'u2', role: 'attorney' })).toBe(false)
    expect(canDeleteLeadActivity({ eventType: 'status_changed', actorId: 'u1' }, { id: 'u1', role: 'admin' })).toBe(false)
  })

  it('merges linked lead and matter activity without duplicate source events', () => {
    const merged = mergeLeadAndMatterActivity(
      [{ id: 'l1', sourceMatterActivityId: 'm1', createdAt: '2026-07-01T00:00:00Z' }],
      [{ id: 'm1', createdAt: '2026-07-02T00:00:00Z' }, { id: 'm2', createdAt: '2026-07-03T00:00:00Z' }],
    )
    expect(merged.map(row => row.id)).toEqual(['m2', 'm1'])
  })
})
