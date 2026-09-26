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
