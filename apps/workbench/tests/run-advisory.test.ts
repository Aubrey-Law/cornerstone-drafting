import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from '@/lib/supabase/database'
import { loadUnresolvedBlockers, toBlockerAdvisories } from '@/lib/runs/advisory'
import { makeFakeClient } from './helpers/fakeSupabase'

const finding = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'f1',
  run_id: 'run-1',
  rule_number: '1',
  outcome: 'deviation',
  severity: 'blocker',
  disposition: 'open',
  ...over,
})

describe('which findings a matter is warned about', () => {
  it('warns about an open blocker', () => {
    expect(toBlockerAdvisories([finding()], { 'run-1': 'matter-1' })).toHaveLength(1)
  })

  it('says nothing about a blocker somebody has already dispositioned', () => {
    // The whole point of reusing `disposition`: dispositioning a false
    // positive is what clears it. If an accepted or rejected finding kept
    // warning, the list would only ever grow and would stop being read.
    for (const disposition of ['accepted', 'rejected', 'deferred']) {
      expect(toBlockerAdvisories([finding({ disposition })], { 'run-1': 'matter-1' })).toEqual([])
    }
  })

  it('says nothing about a lesser severity', () => {
    for (const severity of ['high', 'medium', 'low', null]) {
      expect(toBlockerAdvisories([finding({ severity })], { 'run-1': 'matter-1' })).toEqual([])
    }
  })

  it('says nothing about a compliant finding, whatever its severity', () => {
    expect(toBlockerAdvisories([finding({ outcome: 'compliant' })], { 'run-1': 'matter-1' })).toEqual([])
  })

  it('says nothing about a not-applicable finding', () => {
    expect(toBlockerAdvisories([finding({ outcome: 'not_applicable' })], { 'run-1': 'matter-1' })).toEqual([])
  })

  it('warns about an absent finding, not only a deviation', () => {
    expect(toBlockerAdvisories([finding({ outcome: 'absent' })], { 'run-1': 'matter-1' })).toHaveLength(1)
  })

  it('drops a finding whose run has no known matter, rather than surfacing a blank', () => {
    expect(toBlockerAdvisories([finding()], {})).toEqual([])
  })
})

/**
 * `loadUnresolvedBlockers` against a fake client — the same fixture idiom
 * `tests/run-triggers.test.ts` uses for `materialiseStageTrigger`: seeded
 * tables stand in for the three plain queries (findings, runs, matters).
 */
describe('loadUnresolvedBlockers', () => {
  it('names the matter behind each unresolved blocker', async () => {
    const client = makeFakeClient({
      workflow_findings: [finding()],
      workflow_runs: [{ id: 'run-1', matter_id: 'matter-1' }],
      matters: [{ id: 'matter-1', name: 'Smith Family Trust' }],
    })

    const blockers = await loadUnresolvedBlockers(client as unknown as SupabaseClient<WorkbenchDatabase>)

    expect(blockers).toEqual([
      { findingId: 'f1', runId: 'run-1', matterId: 'matter-1', matterTitle: 'Smith Family Trust', ruleNumber: '1' },
    ])
  })

  it('is empty when nothing is unresolved', async () => {
    const client = makeFakeClient({
      workflow_findings: [finding({ disposition: 'accepted' })],
      workflow_runs: [{ id: 'run-1', matter_id: 'matter-1' }],
      matters: [{ id: 'matter-1', name: 'Smith Family Trust' }],
    })

    const blockers = await loadUnresolvedBlockers(client as unknown as SupabaseClient<WorkbenchDatabase>)

    expect(blockers).toEqual([])
  })
})
