import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from '@/lib/supabase/database'
import { ruleOrder } from './history'

/**
 * Which findings a matter is warned about on `/prompts`, advisory only.
 *
 * The design-sheet audit now fires on a stage entry (see the migration
 * turning `fires_on_stage_entry` on for it), and the owner's decision,
 * documented in `docs/superpowers/specs/2026-09-06-stage-triggered-runs-design.md`,
 * is that a blocker finding never blocks a transition: both version 1 and
 * version 2 of that audit produced blocker-level false positives on a real
 * matter, and a hard gate would have stopped a well-drafted matter from
 * advancing on a wrong finding. So a transition always succeeds, and an
 * unresolved blocker is only surfaced here.
 *
 * "Unresolved" needs no new state. `workflow_findings.disposition` already
 * carries `open | accepted | rejected | deferred`, and `saveDisposition`
 * (`lib/review/persist.ts`) already writes it. Reusing it is the point:
 * dispositioning a false positive — accepting it, rejecting it, deferring it —
 * is exactly the action that clears it from this list. If an accepted or
 * rejected finding kept warning, the list would only ever grow and would stop
 * being read, which is the failure mode that makes an advisory worthless.
 *
 * `toBlockerAdvisories` is pure and is the whole gate: everything the list
 * shows or omits is decided here, tested directly, rather than left to
 * whatever a SQL filter happens to also apply.
 */

type Row = Record<string, unknown>

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null

/** Outcomes a blocker is worth warning about. A `compliant` or `not_applicable` finding never is, whatever its severity. */
const WARNING_OUTCOMES = new Set(['deviation', 'absent'])

export interface BlockerAdvisory {
  findingId: string
  runId: string
  matterId: string
  ruleNumber: string
}

/**
 * `findings` as read from `workflow_findings` (or anything with the same
 * shape); `matterByRun` maps a run's id to the matter it ran against, the way
 * `loadUnresolvedBlockers` below resolves it from `workflow_runs`.
 *
 * A finding whose run has no known matter is dropped rather than surfaced
 * with a blank — that is a data inconsistency to notice elsewhere, not
 * something this advisory should show half of.
 */
export function toBlockerAdvisories(findings: readonly Row[], matterByRun: Record<string, string>): BlockerAdvisory[] {
  const advisories: BlockerAdvisory[] = []
  for (const finding of findings) {
    if (str(finding.severity) !== 'blocker') continue
    if (str(finding.disposition) !== 'open') continue
    const outcome = str(finding.outcome)
    if (!outcome || !WARNING_OUTCOMES.has(outcome)) continue

    const runId = str(finding.run_id)
    const matterId = runId ? matterByRun[runId] : undefined
    if (!runId || !matterId) continue

    advisories.push({
      findingId: String(finding.id),
      runId,
      matterId,
      ruleNumber: String(finding.rule_number ?? ''),
    })
  }
  return advisories
}

/**
 * A run's identity for superseding purposes: which prompt it answers
 * (`null` when that cannot be resolved) and when it started.
 */
export interface RunSupersedeInfo {
  promptId: string | null
  startedAt: string
}

export interface UnresolvedBlockerMatter {
  matterId: string
  runId: string
  ruleNumbers: string[]
}

/**
 * Drops advisories from a superseded run of the same prompt, then groups
 * what remains by matter.
 *
 * A matter that entered `design`, then `drafting`, then `design` again fires
 * the same stage-entry audit three times. Only the newest of those three
 * runs is the current answer to the question the audit asks; the other two
 * are stale answers to a question already re-answered. `tasksToSupersede`
 * (`lib/fieldAudit/tasks.ts`) already encodes exactly this notion for the
 * tasks a run emits — a newer run's tasks replace an older run's, not add to
 * them — and this is the same idea applied to the advisory instead of
 * inventing a second one.
 *
 * "Same prompt" is decided by `prompt_versions.prompt_id`, not by
 * `workflow_runs.prompt_version_id`: two different versions of one prompt
 * are still one prompt, so a run of version 2 supersedes a run of version 1
 * the same way a second run of the identical version would. Grouping by
 * version instead would let every edited prompt start warning about its own
 * predecessor's findings all over again, which is exactly the six-rows-for-
 * one-matter failure this function exists to stop.
 *
 * A run whose prompt cannot be resolved (`runInfo` has no entry, or its
 * `promptId` is `null` — a deleted or not-yet-migrated prompt version) is
 * judged only against itself: with no prompt to group it by, there is no
 * basis for calling any other run "the same question", so such a run can
 * neither supersede nor be superseded.
 *
 * Grouping by matter happens only after superseding, on what survives it:
 * one entry per matter, naming every check still unresolved on it (sorted
 * the way `toStoredFieldAuditFindings` orders check numbers) and linking to
 * the newest of its surviving runs — one row per matter, not one row per
 * finding.
 */
export function groupUnresolvedBlockersByMatter(
  advisories: readonly BlockerAdvisory[],
  runInfo: Record<string, RunSupersedeInfo>,
): UnresolvedBlockerMatter[] {
  const supersedeKey = (advisory: BlockerAdvisory): string => {
    const promptId = runInfo[advisory.runId]?.promptId
    // No resolvable prompt → its own singleton group, never superseding or
    // superseded by anything.
    return promptId ? `${advisory.matterId}::${promptId}` : `run:${advisory.runId}`
  }
  const startedAtOf = (advisory: BlockerAdvisory): string => runInfo[advisory.runId]?.startedAt ?? ''

  // The newest run per (matter, prompt) group — the only run in that group
  // whose findings are still the current answer.
  const latestRunByGroup = new Map<string, string>()
  const latestStartedAtByGroup = new Map<string, string>()
  for (const advisory of advisories) {
    const key = supersedeKey(advisory)
    const startedAt = startedAtOf(advisory)
    const currentStartedAt = latestStartedAtByGroup.get(key)
    if (currentStartedAt === undefined || startedAt > currentStartedAt) {
      latestStartedAtByGroup.set(key, startedAt)
      latestRunByGroup.set(key, advisory.runId)
    }
  }

  const current = advisories.filter((advisory) => latestRunByGroup.get(supersedeKey(advisory)) === advisory.runId)

  const byMatter = new Map<string, { runId: string; startedAt: string; ruleNumbers: Set<string> }>()
  for (const advisory of current) {
    const startedAt = startedAtOf(advisory)
    const existing = byMatter.get(advisory.matterId)
    if (!existing) {
      byMatter.set(advisory.matterId, { runId: advisory.runId, startedAt, ruleNumbers: new Set([advisory.ruleNumber]) })
      continue
    }
    existing.ruleNumbers.add(advisory.ruleNumber)
    // The run to link the matter to is the newest across all its surviving
    // checks, even when they came from different prompts.
    if (startedAt > existing.startedAt) {
      existing.runId = advisory.runId
      existing.startedAt = startedAt
    }
  }

  return [...byMatter.entries()].map(([matterId, group]) => ({
    matterId,
    runId: group.runId,
    ruleNumbers: [...group.ruleNumbers].sort((a, b) => {
      const [aNum, aRaw] = ruleOrder(a)
      const [bNum, bRaw] = ruleOrder(b)
      return aNum - bNum || aRaw.localeCompare(bRaw)
    }),
  }))
}

export interface UnresolvedBlocker {
  matterId: string
  matterTitle: string
  runId: string
  ruleNumbers: string[]
}

/**
 * Every matter with an unresolved blocker on record, one entry per matter —
 * the list `/prompts` shows above the picker.
 *
 * The `.eq`/`.in` filters below narrow what comes over the wire; they are not
 * what decides which findings are advisories. `toBlockerAdvisories` above is
 * — every row this function fetches is passed through it, so a filter here
 * drifting out of step with that gate would only cost round-trip size, never
 * correctness. `groupUnresolvedBlockersByMatter` is the analogous gate for
 * which run's findings are current and how they are grouped for display.
 *
 * Plain queries rather than a PostgREST embedded select, following
 * `lib/prompts/designSheet.ts`'s `loadMattersWithDesignSheets`: an embedded
 * form cannot be checked column-by-column by this codebase's offline column
 * safety net (`tests/query-columns.test.ts`, `scripts/checkDbColumns.mjs`).
 */
export async function loadUnresolvedBlockers(client: SupabaseClient<WorkbenchDatabase>): Promise<UnresolvedBlocker[]> {
  const sb = client

  const { data: findings, error: findingsError } = await sb
    .from('workflow_findings')
    .select('id, run_id, rule_number, outcome, severity, disposition')
    .eq('severity', 'blocker')
    .eq('disposition', 'open')
    .in('outcome', ['deviation', 'absent'])
  if (findingsError) throw new Error(`Could not load findings: ${findingsError.message}`)
  if (!findings || findings.length === 0) return []

  const runIds = [...new Set(findings.map((finding) => String(finding.run_id)))]
  const { data: runs, error: runsError } = await sb
    .from('workflow_runs')
    .select('id, matter_id, prompt_version_id, started_at')
    .in('id', runIds)
  if (runsError) throw new Error(`Could not load runs: ${runsError.message}`)

  const matterByRun: Record<string, string> = {}
  const promptVersionByRun: Record<string, string | null> = {}
  const startedAtByRun: Record<string, string> = {}
  for (const run of runs ?? []) {
    const runId = String(run.id)
    matterByRun[runId] = String(run.matter_id)
    promptVersionByRun[runId] = (run.prompt_version_id as string | null) ?? null
    startedAtByRun[runId] = str(run.started_at) ?? ''
  }

  const advisories = toBlockerAdvisories(findings, matterByRun)
  if (advisories.length === 0) return []

  // Resolve each implicated run's prompt *version* to the prompt it is a
  // version of — `groupUnresolvedBlockersByMatter` supersedes by prompt, not
  // by version, so this join is what makes "version 2 supersedes version 1"
  // possible rather than "version 2 is a different prompt from version 1".
  const versionIds = [...new Set(Object.values(promptVersionByRun).filter((id): id is string => id !== null))]
  const { data: promptVersions, error: promptVersionsError } = versionIds.length
    ? await sb.from('prompt_versions').select('id, prompt_id').in('id', versionIds)
    : { data: [] as Row[], error: null }
  if (promptVersionsError) throw new Error(`Could not load prompt versions: ${promptVersionsError.message}`)

  const promptByVersion = new Map((promptVersions ?? []).map((version) => [String(version.id), String(version.prompt_id)]))

  const runInfo: Record<string, RunSupersedeInfo> = {}
  for (const runId of Object.keys(matterByRun)) {
    const versionId = promptVersionByRun[runId]
    runInfo[runId] = {
      promptId: versionId ? (promptByVersion.get(versionId) ?? null) : null,
      startedAt: startedAtByRun[runId] ?? '',
    }
  }

  const groups = groupUnresolvedBlockersByMatter(advisories, runInfo)
  if (groups.length === 0) return []

  const matterIds = [...new Set(groups.map((group) => group.matterId))]
  const { data: matters, error: mattersError } = await sb.from('matters').select('id, name').in('id', matterIds)
  if (mattersError) throw new Error(`Could not load matters: ${mattersError.message}`)

  const titleByMatter = new Map((matters ?? []).map((matter) => [String(matter.id), str(matter.name) ?? 'Untitled matter']))

  return groups.map((group) => ({
    ...group,
    matterTitle: titleByMatter.get(group.matterId) ?? 'Untitled matter',
  }))
}
