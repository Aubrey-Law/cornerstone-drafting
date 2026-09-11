import { expect, it } from 'vitest'
import { draftingProgress } from '@/lib/drafting/workspaceProgress'
import { formatElapsed } from '@/lib/drafting/metrics'
import { sourceRevision } from '@/lib/drafting/runState'
it('completes review only when every current version has a recorded review', () => {
  expect(draftingProgress(true, 1, [{ reviewedAt: null }], []).review).toBe('pending')
  expect(draftingProgress(true, 1, [{ reviewedAt: 'today' }], []).review).toBe('complete')
  expect(draftingProgress(true, 2, [{ reviewedAt: 'today' }], []).review).toBe('pending')
  expect(draftingProgress(true, 0, [], [{ reviewed_at: 'today' }])).toEqual({ design: 'complete', generate: 'complete', review: 'complete' })
  expect(draftingProgress(true, 0, [], []).review).toBe('pending')
})
it('source revisions include clause map content and are independent of insertion order', () => {
  const one = { overrides: new Map([['a', { text: 'A' }], ['b', { text: 'B' }]]) }
  expect(sourceRevision(one)).toBe(sourceRevision({ overrides: new Map([...one.overrides].reverse()) }))
  expect(sourceRevision(one)).not.toBe(sourceRevision({ overrides: new Map([['a', { text: 'Changed' }], ['b', { text: 'B' }]]) }))
})
it('labels elapsed telemetry honestly without a fabricated zero sample', () => {
  expect(formatElapsed(null)).toBe('No completed samples')
  expect(formatElapsed(90)).toBe('2 min')
})
