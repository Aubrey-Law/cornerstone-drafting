import { describe, expect, it } from 'vitest'
import {
  actionsFor,
  applyReviewEvent,
  bulkReplacements,
  filterRows,
  ruleHeading,
  ruleRows,
  tally,
  commentText,
  EMPTY_REVIEW,
  orderFindings,
  parseReviewFrame,
  settledCount,
  type ReviewFindingEvent,
  type ReviewRuleInfo,
} from '../model'

const RULES: ReviewRuleInfo[] = [
  { number: '1', risk: 'medium', statement: 'Bond is waived for named trustees.', preferredLanguage: null },
  { number: '2', risk: 'blocker', statement: 'Discretionary standards address other resources.', preferredLanguage: 'considering other resources' },
  { number: '3', risk: 'high', statement: 'Guardians are named.', preferredLanguage: null },
]

const finding = (over: Partial<ReviewFindingEvent>): ReviewFindingEvent => ({
  ruleNumber: '1',
  outcome: 'compliant',
  severity: null,
  rationale: 'ok',
  proposedLanguage: null,
  citation: null,
  citationRefusal: null,
  attemptedQuote: null,
  ...over,
})

const cited = { blockIndex: 4, quote: 'The Trustee shall serve without bond.', verification: 'verified' as const }

describe('applyReviewEvent', () => {
  it('builds up a run from the stream and counts settled rules once each', () => {
    let state = applyReviewEvent(EMPTY_REVIEW, {
      start: true,
      playbook: { slug: 's', title: 'T', version: 2 },
      rules: RULES,
      matterContext: { state: 'applied' },
    })
    state = applyReviewEvent(state, { finding: finding({ ruleNumber: '1' }) })
    state = applyReviewEvent(state, { failure: { ruleNumber: '2', reason: 'overloaded' } })
    expect(settledCount(state)).toBe(2)
    expect(state.done).toBe(false)
    state = applyReviewEvent(state, { done: true, completed: 3, aborted: false })
    expect(state.done).toBe(true)
  })

  it('carries whether the review is being saved, and a save that stopped part-way', () => {
    let state = applyReviewEvent(EMPTY_REVIEW, {
      start: true,
      playbook: { slug: 's', title: 'T', version: 2 },
      rules: RULES,
      matterContext: { state: 'none' },
      recording: { saved: true, runId: 'run-1' },
    })
    expect(state.recording).toEqual({ saved: true, runId: 'run-1' })
    state = applyReviewEvent(state, { done: true, completed: 3, aborted: false, saved: false, recordingProblem: 'db down' })
    expect(state).toMatchObject({ done: true, recordingProblem: 'db down' })

    const unsaved = applyReviewEvent(EMPTY_REVIEW, {
      start: true,
      playbook: { slug: 's', title: 'T', version: 2 },
      rules: RULES,
      matterContext: { state: 'none' },
      recording: { saved: false, reason: 'too large' },
    })
    expect(unsaved.recording).toEqual({ saved: false, reason: 'too large' })
  })

  it('reads a start frame from a server that predates recording as not reporting it', () => {
    const state = applyReviewEvent(EMPTY_REVIEW, {
      start: true,
      playbook: { slug: 's', title: 'T', version: 2 },
      rules: RULES,
      matterContext: { state: 'none' },
    })
    expect(state.recording).toBeNull()
  })

  it('treats a stream error as the end of the run', () => {
    const state = applyReviewEvent(EMPTY_REVIEW, { error: 'boom' })
    expect(state).toMatchObject({ done: true, error: 'boom' })
  })
})

describe('parseReviewFrame', () => {
  it('reads a data frame and drops anything malformed', () => {
    expect(parseReviewFrame('data: {"done":true,"completed":1,"aborted":false}')).toEqual({ done: true, completed: 1, aborted: false })
    expect(parseReviewFrame('data: {not json')).toBeNull()
    expect(parseReviewFrame(': keep-alive')).toBeNull()
  })
})

describe('orderFindings', () => {
  it('puts issues first, most severe first, then playbook order', () => {
    const ordered = orderFindings(
      [
        finding({ ruleNumber: '1', outcome: 'compliant' }),
        finding({ ruleNumber: '3', outcome: 'deviation', severity: 'high' }),
        finding({ ruleNumber: '2', outcome: 'absent', severity: 'blocker' }),
      ],
      RULES,
    )
    expect(ordered.map((f) => f.ruleNumber)).toEqual(['2', '3', '1'])
  })
})

describe('actionsFor', () => {
  it('offers markup only on a verified citation', () => {
    const deviation = finding({ ruleNumber: '1', outcome: 'deviation', severity: 'medium', citation: cited, proposedLanguage: 'without bond, if named herein' })
    expect(actionsFor(deviation, RULES[0])).toEqual({
      reveal: true,
      comment: true,
      replace: 'without bond, if named herein',
      insert: null,
    })
    const unverified = { ...deviation, citation: null, attemptedQuote: 'something else' }
    expect(actionsFor(unverified, RULES[0])).toEqual({ reveal: false, comment: false, replace: null, insert: null })
  })

  it('offers the firm language for an absence, and nothing to replace', () => {
    const absent = finding({ ruleNumber: '2', outcome: 'absent', severity: 'blocker' })
    expect(actionsFor(absent, RULES[1])).toEqual({ reveal: false, comment: false, replace: null, insert: 'considering other resources' })
  })

  it('offers no comment on a passing rule', () => {
    expect(actionsFor(finding({ citation: cited }), RULES[0]).comment).toBe(false)
  })
})

describe('commentText', () => {
  it('names the playbook, rule and severity, then the rationale and suggestion', () => {
    const text = commentText(
      finding({ ruleNumber: '1', outcome: 'deviation', severity: 'medium', rationale: 'Waiver runs to anyone.', proposedLanguage: 'named trustees only' }),
      RULES[0],
      'Trust review',
    )
    expect(text).toBe(
      'Cornerstone review — Trust review, rule 1 (medium)\nBond is waived for named trustees.\n\nWaiver runs to anyone.\n\nSuggested: named trustees only',
    )
  })
})

describe('the report view', () => {
  const state = {
    ...EMPTY_REVIEW,
    rules: [...RULES, { number: '4', risk: 'low' as const, statement: 'Pets are provided for.', preferredLanguage: null }],
    findings: [
      finding({ ruleNumber: '1', outcome: 'compliant' }),
      finding({ ruleNumber: '2', outcome: 'deviation', severity: 'blocker', citation: cited, proposedLanguage: 'considering other resources' }),
      finding({ ruleNumber: '3', outcome: 'not_applicable' }),
    ],
    failures: [] as Array<{ ruleNumber: string; reason: string }>,
  }

  it('gives every rule a status, keeping unsettled and failed-to-run rules apart from passes', () => {
    const rows = ruleRows({ ...state, failures: [{ ruleNumber: '4', reason: 'timeout' }] })
    expect(rows.map((r) => r.status)).toEqual(['passed', 'failed', 'not_applicable', 'did_not_run'])
    expect(rows[3].failureReason).toBe('timeout')
    expect(ruleRows(state)[3].status).toBe('pending')
  })

  it('counts a pass rate over checked, applicable rules, never rounding a failure up to 100%', () => {
    expect(tally(ruleRows(state))).toMatchObject({ passed: 1, failed: 1, notApplicable: 1, pending: 1, percentPassed: 50 })
    const many = { ...state, rules: [] as ReviewRuleInfo[], findings: [] as ReviewFindingEvent[] }
    for (let i = 0; i < 200; i++) {
      many.rules.push({ number: String(i), risk: 'low', statement: `r${i}`, preferredLanguage: null })
      many.findings.push(finding({ ruleNumber: String(i), outcome: i === 0 ? 'deviation' : 'compliant' }))
    }
    expect(tally(ruleRows(many)).percentPassed).toBe(99)
    expect(tally(ruleRows(EMPTY_REVIEW)).percentPassed).toBeNull()
  })

  it('filters by status and text, and sorts failures first by severity', () => {
    const rows = ruleRows(state)
    expect(filterRows(rows, { status: 'failed', query: '', sort: 'playbook' }).map((r) => r.rule.number)).toEqual(['2'])
    expect(filterRows(rows, { status: 'all', query: 'GUARDIANS', sort: 'playbook' }).map((r) => r.rule.number)).toEqual(['3'])
    expect(filterRows(rows, { status: 'all', query: '', sort: 'severity' }).map((r) => r.rule.number)).toEqual(['2', '4', '1', '3'])
  })

  it('bulk-applies only verified deviations with proposed language', () => {
    const withUnverified = {
      ...state,
      findings: [
        ...state.findings,
        finding({ ruleNumber: '4', outcome: 'deviation', proposedLanguage: 'x', citation: { ...cited, verification: 'unverified' } }),
      ],
    }
    expect(bulkReplacements(withUnverified).map((r) => [r.finding.ruleNumber, r.text])).toEqual([['2', 'considering other resources']])
  })
})

describe('rule titles', () => {
  it('lists a rule by its title, falling back to the statement', () => {
    expect(ruleHeading({ ...RULES[0], title: 'Bond Waiver' }, '1')).toBe('Bond Waiver')
    expect(ruleHeading({ ...RULES[0], title: '  ' }, '1')).toBe('Bond is waived for named trustees.')
    expect(ruleHeading(undefined, '7')).toBe('Rule 7')
  })

  it('puts the title in the Word comment and lets search find it', () => {
    const rule = { ...RULES[1], title: 'Other Resources Standard' }
    expect(commentText(finding({ ruleNumber: '2', severity: 'blocker' }), rule, 'T').split('\n').slice(0, 3)).toEqual([
      'Cornerstone review — T, rule 2 (blocker)',
      'Other Resources Standard',
      'Discretionary standards address other resources.',
    ])
    const rows = ruleRows({ ...EMPTY_REVIEW, rules: [RULES[0], rule] })
    expect(filterRows(rows, { status: 'all', query: 'resources standard', sort: 'playbook' }).map((r) => r.rule.number)).toEqual(['2'])
  })
})
