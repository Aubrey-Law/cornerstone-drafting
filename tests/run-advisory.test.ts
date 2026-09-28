import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { GeneratedDatabase } from '@/types/supabase'
import { groupUnresolvedBlockersByMatter, loadUnresolvedBlockers, toBlockerAdvisories } from '@/lib/runs/advisory'
import { makeFakeClient } from './helpers/reviewFakeSupabase'

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
 * `groupUnresolvedBlockersByMatter` pure, without a client: which run of a
 * matter's several a finding is judged against, and how survivors are
 * grouped for display.
 */
describe('grouping unresolved blockers by matter, superseded runs dropped', () => {
  it('drops a finding from a superseded run of the same prompt; the latest run of that prompt still advises', () => {
    const advisories = [
      { findingId: 'f1', runId: 'run-old', matterId: 'matter-1', ruleNumber: '1' },
      { findingId: 'f2', runId: 'run-new', matterId: 'matter-1', ruleNumber: '2' },
    ]
    const runInfo = {
      'run-old': { promptId: 'prompt-1', startedAt: '2026-01-01T00:00:00Z' },
      'run-new': { promptId: 'prompt-1', startedAt: '2026-02-01T00:00:00Z' },
    }

    expect(groupUnresolvedBlockersByMatter(advisories, runInfo)).toEqual([
      { matterId: 'matter-1', runId: 'run-new', ruleNumbers: ['2'] },
    ])
  })

  it('lets two different prompts on the same matter both advise, since neither supersedes the other', () => {
    const advisories = [
      { findingId: 'f1', runId: 'run-a', matterId: 'matter-1', ruleNumber: '1' },
      { findingId: 'f2', runId: 'run-b', matterId: 'matter-1', ruleNumber: '2' },
    ]
    const runInfo = {
      'run-a': { promptId: 'prompt-a', startedAt: '2026-01-01T00:00:00Z' },
      'run-b': { promptId: 'prompt-b', startedAt: '2026-01-02T00:00:00Z' },
    }

    // Neither run supersedes the other — different prompts — so both checks
    // survive and land on the one matter entry.
    expect(groupUnresolvedBlockersByMatter(advisories, runInfo)).toEqual([
      { matterId: 'matter-1', runId: 'run-b', ruleNumbers: ['1', '2'] },
    ])
  })

  it('gives one matter with several unresolved checks one entry naming them all', () => {
    const advisories = [
      { findingId: 'f1', runId: 'run-1', matterId: 'matter-1', ruleNumber: '2' },
      { findingId: 'f2', runId: 'run-1', matterId: 'matter-1', ruleNumber: '1' },
    ]
    const runInfo = { 'run-1': { promptId: 'prompt-1', startedAt: '2026-01-01T00:00:00Z' } }

    // Sorted by check number, not insertion order.
    expect(groupUnresolvedBlockersByMatter(advisories, runInfo)).toEqual([
      { matterId: 'matter-1', runId: 'run-1', ruleNumbers: ['1', '2'] },
    ])
  })

  it('gives two matters two entries', () => {
    const advisories = [
      { findingId: 'f1', runId: 'run-1', matterId: 'matter-1', ruleNumber: '1' },
      { findingId: 'f2', runId: 'run-2', matterId: 'matter-2', ruleNumber: '1' },
    ]
    const runInfo = {
      'run-1': { promptId: 'prompt-1', startedAt: '2026-01-01T00:00:00Z' },
      'run-2': { promptId: 'prompt-1', startedAt: '2026-01-01T00:00:00Z' },
    }

    expect(groupUnresolvedBlockersByMatter(advisories, runInfo)).toEqual([
      { matterId: 'matter-1', runId: 'run-1', ruleNumbers: ['1'] },
      { matterId: 'matter-2', runId: 'run-2', ruleNumbers: ['1'] },
    ])
  })

  /**
   * Version 3 of the design-sheet audit is real (the real matter this branch
   * exists to fix had already reached it): this proves versions 1 and 2 of
   * *one* prompt still supersede each other, not just two runs that happen
   * to share one literal `prompt_version_id`. Grouping by version instead of
   * by prompt would fail this — see the break/restore experiment in the
   * commit message and the task report.
   */
  it('lets a newer version of the same prompt supersede an older version of it', () => {
    const advisories = [
      { findingId: 'f1', runId: 'run-v1', matterId: 'matter-1', ruleNumber: '1' },
      { findingId: 'f2', runId: 'run-v2', matterId: 'matter-1', ruleNumber: '2' },
    ]
    const runInfo = {
      'run-v1': { promptId: 'design-sheet-audit', startedAt: '2026-01-01T00:00:00Z' },
      'run-v2': { promptId: 'design-sheet-audit', startedAt: '2026-02-01T00:00:00Z' },
    }

    expect(groupUnresolvedBlockersByMatter(advisories, runInfo)).toEqual([
      { matterId: 'matter-1', runId: 'run-v2', ruleNumbers: ['2'] },
    ])
  })

  it('judges a run whose prompt cannot be resolved only against itself', () => {
    const advisories = [
      { findingId: 'f1', runId: 'run-1', matterId: 'matter-1', ruleNumber: '1' },
      { findingId: 'f2', runId: 'run-2', matterId: 'matter-1', ruleNumber: '2' },
    ]
    const runInfo = {
      'run-1': { promptId: null, startedAt: '2026-01-01T00:00:00Z' },
      'run-2': { promptId: null, startedAt: '2026-02-01T00:00:00Z' },
    }

    // Neither has a resolvable prompt, so neither supersedes the other —
    // both survive, unlike the matching-prompt case above.
    expect(groupUnresolvedBlockersByMatter(advisories, runInfo)).toEqual([
      { matterId: 'matter-1', runId: 'run-2', ruleNumbers: ['1', '2'] },
    ])
  })
})

/**
 * `loadUnresolvedBlockers` against a fake client — the same fixture idiom
 * `tests/run-triggers.test.ts` uses for `materialiseStageTrigger`: seeded
 * tables stand in for the four plain queries (findings, runs, prompt
 * versions, matters).
 */
describe('loadUnresolvedBlockers', () => {
  it('names the matter behind an unresolved blocker, naming its check', async () => {
    const client = makeFakeClient({
      workflow_findings: [finding()],
      workflow_runs: [{ id: 'run-1', matter_id: 'matter-1', prompt_version_id: 'pv-1', started_at: '2026-01-01T00:00:00Z' }],
      prompt_versions: [{ id: 'pv-1', prompt_id: 'prompt-1' }],
      matters: [{ id: 'matter-1', name: 'Smith Family Trust' }],
    })

    const blockers = await loadUnresolvedBlockers(client as unknown as SupabaseClient<GeneratedDatabase>)

    expect(blockers).toEqual([
      { matterId: 'matter-1', matterTitle: 'Smith Family Trust', runId: 'run-1', ruleNumbers: ['1'] },
    ])
  })

  it('is empty when nothing is unresolved', async () => {
    const client = makeFakeClient({
      workflow_findings: [finding({ disposition: 'accepted' })],
      workflow_runs: [{ id: 'run-1', matter_id: 'matter-1' }],
      matters: [{ id: 'matter-1', name: 'Smith Family Trust' }],
    })

    const blockers = await loadUnresolvedBlockers(client as unknown as SupabaseClient<GeneratedDatabase>)

    expect(blockers).toEqual([])
  })

  /**
   * The real bug this branch fixes: a matter that entered `design`, then
   * `drafting`, then `design` again fired the same field-audit prompt three
   * times, and all three runs' blocker findings survived to the advisory —
   * six rows for one matter. Only the newest run's findings should.
   */
  it('does not advise on a superseded run of the same prompt against the same matter', async () => {
    const client = makeFakeClient({
      workflow_findings: [
        finding({ id: 'f-old-1', run_id: 'run-design-1', rule_number: '1' }),
        finding({ id: 'f-old-2', run_id: 'run-design-1', rule_number: '2' }),
        finding({ id: 'f-mid', run_id: 'run-drafting', rule_number: '1' }),
        finding({ id: 'f-new-1', run_id: 'run-design-2', rule_number: '1' }),
        finding({ id: 'f-new-2', run_id: 'run-design-2', rule_number: '2' }),
      ],
      workflow_runs: [
        { id: 'run-design-1', matter_id: 'matter-1', prompt_version_id: 'pv-1', started_at: '2026-01-01T00:00:00Z' },
        { id: 'run-drafting', matter_id: 'matter-1', prompt_version_id: 'pv-1', started_at: '2026-01-15T00:00:00Z' },
        { id: 'run-design-2', matter_id: 'matter-1', prompt_version_id: 'pv-1', started_at: '2026-02-01T00:00:00Z' },
      ],
      prompt_versions: [{ id: 'pv-1', prompt_id: 'prompt-1' }],
      matters: [{ id: 'matter-1', name: 'Alexandra Purdue-Smithe — Estate Planning' }],
    })

    const blockers = await loadUnresolvedBlockers(client as unknown as SupabaseClient<GeneratedDatabase>)

    expect(blockers).toEqual([
      {
        matterId: 'matter-1',
        matterTitle: 'Alexandra Purdue-Smithe — Estate Planning',
        runId: 'run-design-2',
        ruleNumbers: ['1', '2'],
      },
    ])
  })

  it('advises on both of two different prompts run against the same matter', async () => {
    const client = makeFakeClient({
      workflow_findings: [
        finding({ id: 'f1', run_id: 'run-a', rule_number: '1' }),
        finding({ id: 'f2', run_id: 'run-b', rule_number: '2' }),
      ],
      workflow_runs: [
        { id: 'run-a', matter_id: 'matter-1', prompt_version_id: 'pv-a', started_at: '2026-01-01T00:00:00Z' },
        { id: 'run-b', matter_id: 'matter-1', prompt_version_id: 'pv-b', started_at: '2026-01-02T00:00:00Z' },
      ],
      prompt_versions: [
        { id: 'pv-a', prompt_id: 'prompt-a' },
        { id: 'pv-b', prompt_id: 'prompt-b' },
      ],
      matters: [{ id: 'matter-1', name: 'Smith Family Trust' }],
    })

    const blockers = await loadUnresolvedBlockers(client as unknown as SupabaseClient<GeneratedDatabase>)

    expect(blockers).toEqual([
      { matterId: 'matter-1', matterTitle: 'Smith Family Trust', runId: 'run-b', ruleNumbers: ['1', '2'] },
    ])
  })

  it('gives two matters two entries', async () => {
    const client = makeFakeClient({
      workflow_findings: [
        finding({ id: 'f1', run_id: 'run-1', rule_number: '1' }),
        finding({ id: 'f2', run_id: 'run-2', rule_number: '1' }),
      ],
      workflow_runs: [
        { id: 'run-1', matter_id: 'matter-1', prompt_version_id: 'pv-1', started_at: '2026-01-01T00:00:00Z' },
        { id: 'run-2', matter_id: 'matter-2', prompt_version_id: 'pv-1', started_at: '2026-01-01T00:00:00Z' },
      ],
      prompt_versions: [{ id: 'pv-1', prompt_id: 'prompt-1' }],
      matters: [
        { id: 'matter-1', name: 'Smith Family Trust' },
        { id: 'matter-2', name: 'Jones Family Trust' },
      ],
    })

    const blockers = await loadUnresolvedBlockers(client as unknown as SupabaseClient<GeneratedDatabase>)

    expect(blockers).toEqual([
      { matterId: 'matter-1', matterTitle: 'Smith Family Trust', runId: 'run-1', ruleNumbers: ['1'] },
      { matterId: 'matter-2', matterTitle: 'Jones Family Trust', runId: 'run-2', ruleNumbers: ['1'] },
    ])
  })

  /**
   * The version-vs-prompt distinction end to end, through the real join
   * (`workflow_runs.prompt_version_id` → `prompt_versions.prompt_id`), not
   * just through `groupUnresolvedBlockersByMatter`'s own unit tests above.
   * Version 3 of the design-sheet audit already exists in this fixture,
   * with no run recorded against it yet — versions 1 and 2 are the ones with
   * runs, which is the live case on the real matter this branch fixes, not
   * a hypothetical.
   */
  it('supersedes a run of an older version of a prompt with a run of a newer version of it', async () => {
    const client = makeFakeClient({
      workflow_findings: [
        finding({ id: 'f1', run_id: 'run-v1', rule_number: '1' }),
        finding({ id: 'f2', run_id: 'run-v2', rule_number: '2' }),
      ],
      workflow_runs: [
        { id: 'run-v1', matter_id: 'matter-1', prompt_version_id: 'design-sheet-audit-v1', started_at: '2026-01-01T00:00:00Z' },
        { id: 'run-v2', matter_id: 'matter-1', prompt_version_id: 'design-sheet-audit-v2', started_at: '2026-02-01T00:00:00Z' },
      ],
      prompt_versions: [
        { id: 'design-sheet-audit-v1', prompt_id: 'design-sheet-audit', version_number: 1 },
        { id: 'design-sheet-audit-v2', prompt_id: 'design-sheet-audit', version_number: 2 },
        { id: 'design-sheet-audit-v3', prompt_id: 'design-sheet-audit', version_number: 3 },
      ],
      matters: [{ id: 'matter-1', name: 'Alexandra Purdue-Smithe — Estate Planning' }],
    })

    const blockers = await loadUnresolvedBlockers(client as unknown as SupabaseClient<GeneratedDatabase>)

    expect(blockers).toEqual([
      {
        matterId: 'matter-1',
        matterTitle: 'Alexandra Purdue-Smithe — Estate Planning',
        runId: 'run-v2',
        ruleNumbers: ['2'],
      },
    ])
  })

  it('clears when a later clean run of the same prompt found nothing', async () => {
    // The case a blockers-first query cannot see. An attorney fixed the
    // design sheet, the matter re-entered the stage, and the re-audit found
    // nothing — so there is nothing to show. Before this, the older run's
    // blocker advised forever, because the clean run had no findings to
    // appear in the query at all and could not supersede it.
    // ...a client with an older run carrying an open blocker, and a newer run
    // of the same prompt with no findings...
    const client = makeFakeClient({
      workflow_findings: [finding({ id: 'f-old', run_id: 'run-old', rule_number: '1' })],
      workflow_runs: [
        { id: 'run-old', matter_id: 'matter-1', prompt_version_id: 'pv-1', started_at: '2026-01-01T00:00:00Z' },
        { id: 'run-new', matter_id: 'matter-1', prompt_version_id: 'pv-1', started_at: '2026-02-01T00:00:00Z' },
      ],
      prompt_versions: [{ id: 'pv-1', prompt_id: 'prompt-1' }],
      matters: [{ id: 'matter-1', name: 'Smith Family Trust' }],
    })

    expect(await loadUnresolvedBlockers(client as never)).toEqual([])
  })

  it('does not let a clean run of a different prompt clear the first prompt\'s blocker', async () => {
    // The clean re-run only clears the (matter, prompt) pair it belongs to.
    // A different prompt's blocker on the same matter is untouched by it.
    const client = makeFakeClient({
      workflow_findings: [finding({ id: 'f-old', run_id: 'run-old', rule_number: '1' })],
      workflow_runs: [
        { id: 'run-old', matter_id: 'matter-1', prompt_version_id: 'pv-a', started_at: '2026-01-01T00:00:00Z' },
        { id: 'run-new-other-prompt', matter_id: 'matter-1', prompt_version_id: 'pv-b', started_at: '2026-02-01T00:00:00Z' },
      ],
      prompt_versions: [
        { id: 'pv-a', prompt_id: 'prompt-a' },
        { id: 'pv-b', prompt_id: 'prompt-b' },
      ],
      matters: [{ id: 'matter-1', name: 'Smith Family Trust' }],
    })

    const blockers = await loadUnresolvedBlockers(client as unknown as SupabaseClient<GeneratedDatabase>)

    expect(blockers).toEqual([
      { matterId: 'matter-1', matterTitle: 'Smith Family Trust', runId: 'run-old', ruleNumbers: ['1'] },
    ])
  })
})
