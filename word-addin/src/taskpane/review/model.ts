/**
 * The Review tab's view of a playbook run, as the server streams it.
 *
 * A copy of the shapes `app/api/addin/review/route.ts` sends, not an import:
 * the pane is its own npm project and cannot reach into the Next app or the
 * citations package (see `word/editTypes.ts` for the same trade).
 *
 * Kept pure — a reducer over stream events — so ordering, counting and the
 * "what can this finding do" decisions are tested without Word or a server.
 */

export type Risk = 'blocker' | 'high' | 'medium' | 'low'
export type Outcome = 'compliant' | 'deviation' | 'absent' | 'not_applicable'

export interface ReviewRuleInfo {
  number: string
  risk: Risk
  statement: string
  preferredLanguage: string | null
}

export interface FindingCitation {
  blockIndex: number
  quote: string
  verification: 'verified' | 'unverified' | 'stale'
}

export interface ReviewFindingEvent {
  ruleNumber: string
  outcome: Outcome
  severity: Risk | null
  rationale: string
  proposedLanguage: string | null
  citation: FindingCitation | null
  citationRefusal: string | null
  attemptedQuote: string | null
}

export type ReviewMatterContext =
  | { state: 'none' }
  | { state: 'applied' }
  | { state: 'no_sheet' }
  | { state: 'unavailable'; reason: string }

export type ReviewRecording = { saved: true; runId: string } | { saved: false; reason: string }

export type ReviewEvent =
  | {
      start: true
      playbook: { slug: string; title: string; version: number }
      rules: ReviewRuleInfo[]
      matterContext: ReviewMatterContext
      /** Whether this review is being saved to review history, and why not when it is not. */
      recording?: ReviewRecording
    }
  | { finding: ReviewFindingEvent }
  | { failure: { ruleNumber: string; reason: string } }
  | { done: true; completed: number; aborted: boolean; saved?: boolean; recordingProblem?: string }
  | { error: string }

export interface ReviewState {
  playbook: { slug: string; title: string; version: number } | null
  rules: ReviewRuleInfo[]
  matterContext: ReviewMatterContext
  /** Null before the review starts, or from a server that predates recording. */
  recording: ReviewRecording | null
  /** Set when recording started but a later write failed. */
  recordingProblem: string | null
  findings: ReviewFindingEvent[]
  failures: Array<{ ruleNumber: string; reason: string }>
  done: boolean
  aborted: boolean
  error: string | null
}

export const EMPTY_REVIEW: ReviewState = {
  playbook: null,
  rules: [],
  matterContext: { state: 'none' },
  recording: null,
  recordingProblem: null,
  findings: [],
  failures: [],
  done: false,
  aborted: false,
  error: null,
}

export function applyReviewEvent(state: ReviewState, event: ReviewEvent): ReviewState {
  if ('start' in event) {
    return {
      ...EMPTY_REVIEW,
      playbook: event.playbook,
      rules: event.rules,
      matterContext: event.matterContext,
      recording: event.recording ?? null,
    }
  }
  if ('finding' in event) return { ...state, findings: [...state.findings, event.finding] }
  if ('failure' in event) return { ...state, failures: [...state.failures, event.failure] }
  if ('done' in event) {
    return { ...state, done: true, aborted: event.aborted, recordingProblem: event.recordingProblem ?? null }
  }
  return { ...state, error: event.error, done: true }
}

/** One frame of `data: {...}` SSE; anything else is ignored rather than fatal. */
export function parseReviewFrame(frame: string): ReviewEvent | null {
  const line = frame.split('\n').find((l) => l.startsWith('data: '))
  if (!line) return null
  try {
    const value = JSON.parse(line.slice(6)) as Record<string, unknown>
    if (value && typeof value === 'object') return value as unknown as ReviewEvent
  } catch {
    /* a malformed frame is dropped, never parsed as a finding */
  }
  return null
}

export function settledCount(state: ReviewState): number {
  return new Set([...state.findings.map((f) => f.ruleNumber), ...state.failures.map((f) => f.ruleNumber)]).size
}

const RISK_ORDER: Record<Risk, number> = { blocker: 0, high: 1, medium: 2, low: 3 }

/** An issue is a deviation or an absence; everything else is a pass or a skip. */
export function isIssue(finding: ReviewFindingEvent): boolean {
  return finding.outcome === 'deviation' || finding.outcome === 'absent'
}

/** Issues first, most severe first, then playbook order — the order an attorney works them. */
export function orderFindings(findings: ReviewFindingEvent[], rules: ReviewRuleInfo[]): ReviewFindingEvent[] {
  const position = new Map(rules.map((rule, index) => [rule.number, index]))
  return [...findings].sort((a, b) => {
    const issueA = isIssue(a) ? 0 : 1
    const issueB = isIssue(b) ? 0 : 1
    if (issueA !== issueB) return issueA - issueB
    const riskA = a.severity ? RISK_ORDER[a.severity] : 9
    const riskB = b.severity ? RISK_ORDER[b.severity] : 9
    if (riskA !== riskB) return riskA - riskB
    return (position.get(a.ruleNumber) ?? 0) - (position.get(b.ruleNumber) ?? 0)
  })
}

export interface FindingActions {
  /** Jump to the passage — only for a verified citation. */
  reveal: boolean
  comment: boolean
  /** Replace the passage with the finding's proposed language, tracked. */
  replace: string | null
  /** Insert the firm's language after the cursor, tracked — for an absence. */
  insert: string | null
}

/**
 * What the pane may offer for a finding.
 *
 * Anything that marks up the document needs a verified citation, the rule the
 * whole review design rests on: a quote the server could not find in this
 * document is a claim, and a comment or redline anchored to a claim is how a
 * reviewer gets misled. An absence has no passage by definition, so its only
 * markup is inserting the firm's language where the attorney puts the cursor.
 */
export function actionsFor(finding: ReviewFindingEvent, rule: ReviewRuleInfo | undefined): FindingActions {
  const cited = finding.citation !== null && finding.citation.verification === 'verified'
  const issue = isIssue(finding)
  return {
    reveal: cited,
    comment: cited && issue,
    replace: cited && finding.outcome === 'deviation' && finding.proposedLanguage ? finding.proposedLanguage : null,
    insert: finding.outcome === 'absent' && rule?.preferredLanguage ? rule.preferredLanguage : null,
  }
}

/** The Word comment text for a finding. */
export function commentText(finding: ReviewFindingEvent, rule: ReviewRuleInfo | undefined, playbookTitle: string): string {
  const lines = [`Cornerstone review — ${playbookTitle}, rule ${finding.ruleNumber}${finding.severity ? ` (${finding.severity})` : ''}`]
  if (rule) lines.push(rule.statement)
  if (finding.rationale) lines.push('', finding.rationale)
  if (finding.proposedLanguage) lines.push('', `Suggested: ${finding.proposedLanguage}`)
  return lines.join('\n')
}

/**
 * Where one rule stands, for the report view. `pending` is a rule the stream
 * has not settled yet; `did_not_run` is one that failed to run, and stays
 * separate from `passed` — a rule that never ran is not a rule that found nothing.
 */
export type RuleStatus = 'passed' | 'failed' | 'not_applicable' | 'did_not_run' | 'pending'

export interface RuleRow {
  rule: ReviewRuleInfo
  status: RuleStatus
  finding: ReviewFindingEvent | null
  failureReason: string | null
}

/** One row per playbook rule, in playbook order. */
export function ruleRows(state: ReviewState): RuleRow[] {
  const findings = new Map(state.findings.map((f) => [f.ruleNumber, f]))
  const failures = new Map(state.failures.map((f) => [f.ruleNumber, f.reason]))
  return state.rules.map((rule) => {
    const finding = findings.get(rule.number) ?? null
    const failureReason = failures.get(rule.number) ?? null
    let status: RuleStatus = 'pending'
    if (finding) {
      status = isIssue(finding) ? 'failed' : finding.outcome === 'not_applicable' ? 'not_applicable' : 'passed'
    } else if (failureReason !== null) {
      status = 'did_not_run'
    }
    return { rule, status, finding, failureReason }
  })
}

export interface ReviewTally {
  passed: number
  failed: number
  notApplicable: number
  didNotRun: number
  pending: number
  /**
   * Passed as a share of rules that were checked and applied. Floored, so a
   * run with any failure never rounds up to 100%. Null until one has settled.
   */
  percentPassed: number | null
}

export function tally(rows: RuleRow[]): ReviewTally {
  const count = (status: RuleStatus) => rows.filter((row) => row.status === status).length
  const passed = count('passed')
  const failed = count('failed')
  return {
    passed,
    failed,
    notApplicable: count('not_applicable'),
    didNotRun: count('did_not_run'),
    pending: count('pending'),
    percentPassed: passed + failed > 0 ? Math.floor((passed / (passed + failed)) * 100) : null,
  }
}

export type StatusFilter = 'all' | RuleStatus
export type RuleSort = 'playbook' | 'severity'

/** The report list: filtered by status and a text query, in playbook or severity order. */
export function filterRows(rows: RuleRow[], options: { status: StatusFilter; query: string; sort: RuleSort }): RuleRow[] {
  const query = options.query.trim().toLowerCase()
  const kept = rows.filter(
    (row) =>
      (options.status === 'all' || row.status === options.status) &&
      (!query ||
        row.rule.statement.toLowerCase().includes(query) ||
        row.rule.number.toLowerCase() === query ||
        (row.finding?.rationale ?? '').toLowerCase().includes(query)),
  )
  if (options.sort === 'playbook') return kept
  const statusOrder: Record<RuleStatus, number> = { failed: 0, did_not_run: 1, pending: 2, passed: 3, not_applicable: 4 }
  return kept
    .map((row, index) => ({ row, index }))
    .sort(
      (a, b) =>
        statusOrder[a.row.status] - statusOrder[b.row.status] ||
        RISK_ORDER[a.row.finding?.severity ?? a.row.rule.risk] - RISK_ORDER[b.row.finding?.severity ?? b.row.rule.risk] ||
        a.index - b.index,
    )
    .map(({ row }) => row)
}

export const RISK_LABEL: Record<Risk, string> = { blocker: 'Blocker', high: 'High', medium: 'Medium', low: 'Low' }

export const STATUS_LABEL: Record<RuleStatus, string> = {
  passed: 'Passed',
  failed: 'Failed',
  not_applicable: 'Not applicable',
  did_not_run: 'Did not run',
  pending: 'Checking',
}

/**
 * The tracked replacements "Apply all" may make: every verified deviation that
 * carries proposed language. Absences are left out on purpose — their firm
 * language goes wherever the cursor is, which only makes sense one at a time.
 */
export function bulkReplacements(state: ReviewState): Array<{ finding: ReviewFindingEvent; text: string }> {
  const rules = new Map(state.rules.map((rule) => [rule.number, rule]))
  return orderFindings(state.findings, state.rules).flatMap((finding) => {
    const replace = actionsFor(finding, rules.get(finding.ruleNumber)).replace
    return replace ? [{ finding, text: replace }] : []
  })
}
