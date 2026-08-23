import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildStageTimeline, type MatterStageHistoryRow } from '@/lib/matters/stageTimeline'

const row = (overrides: Partial<MatterStageHistoryRow> & { id: number; to_stage: string; entered_at: string }): MatterStageHistoryRow => ({
  from_stage: null,
  created_at: overrides.entered_at,
  actor_id: null,
  ...overrides,
})

describe('buildStageTimeline', () => {
  beforeEach(() => vi.useFakeTimers().setSystemTime(new Date('2026-08-23T12:00:00Z')))
  afterEach(() => vi.useRealTimers())

  it('derives how long each stage lasted from when the next one began', () => {
    const entries = buildStageTimeline([
      row({ id: 1, to_stage: 'intake', entered_at: '2026-08-01T12:00:00Z' }),
      row({ id: 2, from_stage: 'intake', to_stage: 'design', entered_at: '2026-08-06T12:00:00Z' }),
      row({ id: 3, from_stage: 'design', to_stage: 'drafting', entered_at: '2026-08-20T12:00:00Z' }),
    ])

    expect(entries.map(entry => [entry.stage, entry.days])).toEqual([
      ['intake', 5],
      ['design', 14],
      // Still open, so counted to today.
      ['drafting', 3],
    ])
  })

  it('marks only the newest entry current and leaves its exit open', () => {
    const entries = buildStageTimeline([
      row({ id: 1, to_stage: 'intake', entered_at: '2026-08-01T12:00:00Z' }),
      row({ id: 2, from_stage: 'intake', to_stage: 'design', entered_at: '2026-08-06T12:00:00Z' }),
    ])

    expect(entries.map(entry => entry.isCurrent)).toEqual([false, true])
    expect(entries[0].exitedAt).toBe('2026-08-06T12:00:00Z')
    expect(entries[1].exitedAt).toBeNull()
  })

  it('marks the earliest row as the start, not as a transition', () => {
    // The first recorded row is either the matter's creation or the row the
    // migration seeded — either way there is no "moved from" to render.
    const entries = buildStageTimeline([
      row({ id: 7, to_stage: 'drafting', entered_at: '2025-11-02T09:00:00Z' }),
      row({ id: 8, from_stage: 'drafting', to_stage: 'client_review', entered_at: '2025-11-20T09:00:00Z' }),
    ])

    expect(entries[0]).toMatchObject({ isStart: true, fromStage: null })
    expect(entries[1]).toMatchObject({ isStart: false, fromStage: 'drafting' })
  })

  it('orders by the business entry date, not insertion order', () => {
    // stage_entered_at can be pinned to a past date, so rows may arrive out of
    // chronological order.
    const entries = buildStageTimeline([
      row({ id: 2, to_stage: 'design', entered_at: '2026-08-10T12:00:00Z' }),
      row({ id: 1, to_stage: 'intake', entered_at: '2026-08-01T12:00:00Z' }),
    ])

    expect(entries.map(entry => entry.stage)).toEqual(['intake', 'design'])
    expect(entries[0].isStart).toBe(true)
  })

  it('breaks ties on the row id when two stages share an entry date', () => {
    const entries = buildStageTimeline([
      row({ id: 5, to_stage: 'drafting', entered_at: '2026-08-10T12:00:00Z' }),
      row({ id: 4, to_stage: 'design', entered_at: '2026-08-10T12:00:00Z' }),
    ])

    expect(entries.map(entry => entry.stage)).toEqual(['design', 'drafting'])
    expect(entries[0].days).toBe(0)
  })

  it('never reports negative time in a stage', () => {
    // A pinned date ahead of the following transition would otherwise subtract
    // to a negative duration.
    const entries = buildStageTimeline([
      row({ id: 1, to_stage: 'intake', entered_at: '2026-08-10T12:00:00Z' }),
      row({ id: 2, from_stage: 'intake', to_stage: 'design', entered_at: '2026-08-01T12:00:00Z' }),
    ])

    expect(entries.every(entry => entry.days >= 0)).toBe(true)
  })

  it('resolves actor names and tolerates an unattributed transition', () => {
    const entries = buildStageTimeline(
      [
        row({ id: 1, to_stage: 'intake', entered_at: '2026-08-01T12:00:00Z', actor_id: 'user-1' }),
        row({ id: 2, from_stage: 'intake', to_stage: 'design', entered_at: '2026-08-06T12:00:00Z' }),
      ],
      new Map([['user-1', 'Scott Aubrey']]),
    )

    expect(entries[0]).toMatchObject({ actorId: 'user-1', actorName: 'Scott Aubrey' })
    expect(entries[1]).toMatchObject({ actorId: null, actorName: null })
  })

  it('returns nothing for a matter with no recorded history', () => {
    expect(buildStageTimeline([])).toEqual([])
  })

  it('does not mutate the rows it was given', () => {
    const rows = [
      row({ id: 2, to_stage: 'design', entered_at: '2026-08-10T12:00:00Z' }),
      row({ id: 1, to_stage: 'intake', entered_at: '2026-08-01T12:00:00Z' }),
    ]
    const snapshot = rows.map(entry => entry.id)
    buildStageTimeline(rows)
    expect(rows.map(entry => entry.id)).toEqual(snapshot)
  })
})
