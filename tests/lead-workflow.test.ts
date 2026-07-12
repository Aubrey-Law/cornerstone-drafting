import { describe, expect, it } from 'vitest'
import { canDeleteLeadActivity, mergeLeadAndMatterActivity } from '@/lib/leads/activity'
import { convertLeadOnce } from '@/lib/leads/conversion'

describe('lead activity', () => {
  it('allows only the note author or an admin to delete a note', () => {
    expect(canDeleteLeadActivity({ eventType: 'note', actorId: 'u1' }, { id: 'u1', role: 'attorney' })).toBe(true)
    expect(canDeleteLeadActivity({ eventType: 'note', actorId: 'u1' }, { id: 'u2', role: 'admin' })).toBe(true)
    expect(canDeleteLeadActivity({ eventType: 'note', actorId: 'u1' }, { id: 'u2', role: 'attorney' })).toBe(false)
    expect(canDeleteLeadActivity({ eventType: 'status_changed', actorId: 'u1' }, { id: 'u1', role: 'admin' })).toBe(false)
  })

  it('merges linked lead and matter activity without duplicate source events', () => {
    const merged = mergeLeadAndMatterActivity(
      [{ id: 'l1', createdAt: '2026-07-01T00:00:00Z' }],
      [{ id: 'm1', sourceLeadActivityId: 'l1', createdAt: '2026-07-02T00:00:00Z' }, { id: 'm2', createdAt: '2026-07-03T00:00:00Z' }],
    )
    expect(merged.map(row => row.id)).toEqual(['m2', 'm1'])
  })
})

describe('lead conversion', () => {
  it('returns the linked matter without creating a duplicate', async () => {
    let creates = 0
    const result = await convertLeadOnce('lead-1', {
      loadLead: async () => ({ id: 'lead-1', matterId: 'matter-1', status: 'hired' }),
      createMatter: async () => { creates += 1; return 'matter-2' },
      linkMatter: async () => undefined,
    })
    expect(result).toEqual({ matterId: 'matter-1', created: false })
    expect(creates).toBe(0)
  })

  it('creates and links a matter once for an open lead', async () => {
    const linked: string[] = []
    const result = await convertLeadOnce('lead-1', {
      loadLead: async () => ({ id: 'lead-1', matterId: null, status: 'lead' }),
      createMatter: async () => 'matter-1',
      linkMatter: async (_leadId, matterId) => { linked.push(matterId) },
    })
    expect(result).toEqual({ matterId: 'matter-1', created: true })
    expect(linked).toEqual(['matter-1'])
  })
})
