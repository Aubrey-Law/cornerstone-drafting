import { describe, expect, it } from 'vitest'
import { assignEventLanes } from '@/app/admin/calendar/eventLayout'

describe('calendar event lanes', () => {
  it('shares lanes across nested/chained appointments and external events deterministically', () => {
    const events = [{ id: 'appt:a', start: 60, end: 120 }, { id: 'google:b', start: 80, end: 100 }, { id: 'appt:c', start: 100, end: 140 }, { id: 'google:d', start: 130, end: 160 }]
    const lanes = assignEventLanes(events)
    expect(lanes).toEqual(assignEventLanes([...events].reverse()))
    expect(lanes.get('google:b')?.lane).toBe(lanes.get('appt:c')?.lane)
    expect([...lanes.values()].every(item => item.lanes === 2)).toBe(true)
    for (const a of events) for (const b of events) {
      if (a.id !== b.id && a.start < b.end && a.end > b.start) expect(lanes.get(a.id)?.lane).not.toBe(lanes.get(b.id)?.lane)
    }
  })
  it('allows adjacent meetings but protects minimum card heights', () => {
    expect(assignEventLanes([{ id: 'a', start: 0, end: 30 }, { id: 'b', start: 30, end: 60 }]).get('b')?.lanes).toBe(1)
    expect(assignEventLanes([{ id: 'a', start: 0, end: 5 }, { id: 'b', start: 5, end: 10 }]).get('b')?.lanes).toBe(2)
  })
})
