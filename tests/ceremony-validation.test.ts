import { describe, expect, it } from 'vitest'
import { ceremonyProblems, documentProblems } from '@/lib/ceremony/validation'

const record = (over: Partial<Parameters<typeof documentProblems>[1]> = {}) => ({
  documentKind: 'will' as const,
  executed: true,
  signedOn: '2026-09-01',
  witnessCount: 2,
  notarized: true,
  recordedOn: null,
  ...over,
})

const ceremony = (over: Partial<Parameters<typeof ceremonyProblems>[0]> = {}) => ({
  witnessOneName: 'Dana Reed',
  witnessTwoName: 'Sam Patel',
  notaryName: 'Alex Cho',
  healthCareAgentName: null,
  ...over,
})

/**
 * Recording an execution is a claim that a document is valid. These checks are
 * what stop the record from asserting something the law would not agree with —
 * which is the only kind of error here that cannot be corrected later, because
 * by the time anyone reads the record the client is usually gone.
 */
describe('documentProblems', () => {
  it('is satisfied by a properly executed will', () => {
    expect(documentProblems(ceremony(), record())).toEqual([])
  })

  it('says nothing about a document that was not executed', () => {
    // An untouched row is a plan, not a claim.
    expect(documentProblems(ceremony(), record({ executed: false, signedOn: null, witnessCount: 0, notarized: false }))).toEqual([])
  })

  /**
   * The failure this table exists to make visible. A will with one witness is
   * not a will, and the record would otherwise say it was signed.
   */
  it('rejects a will witnessed by one person', () => {
    const [problem] = documentProblems(ceremony(), record({ witnessCount: 1 }))
    expect(problem.severity).toBe('invalid')
    expect(problem.message).toMatch(/two witnesses/i)
  })

  it('rejects a health care proxy witnessed by one person', () => {
    const [problem] = documentProblems(
      ceremony(),
      record({ documentKind: 'health_care_proxy', witnessCount: 1, notarized: false }),
    )
    expect(problem.severity).toBe('invalid')
  })

  it('accepts a trust with no witnesses, because none are required', () => {
    expect(
      documentProblems(ceremony(), record({ documentKind: 'trust', witnessCount: 0 })),
    ).toEqual([])
  })

  /**
   * A deed that was not acknowledged cannot be recorded, so the transfer never
   * happens — the trust stays unfunded while the file says otherwise.
   */
  it('rejects a deed that was not notarised', () => {
    const [problem] = documentProblems(
      ceremony(),
      record({ documentKind: 'deed', witnessCount: 0, notarized: false }),
    )
    expect(problem.severity).toBe('invalid')
    expect(problem.message).toMatch(/notar/i)
  })

  it('treats an unrecorded deed as unfinished rather than invalid', () => {
    // The deed is good between the parties; recording is what protects it, and
    // it happens after the appointment.
    const [problem] = documentProblems(
      ceremony(),
      record({ documentKind: 'deed', witnessCount: 0, notarized: true, recordedOn: null }),
    )
    expect(problem.severity).toBe('incomplete')
    expect(problem.message).toMatch(/recorded/i)
  })

  it('is satisfied once the deed is recorded', () => {
    expect(
      documentProblems(
        ceremony(),
        record({ documentKind: 'deed', witnessCount: 0, notarized: true, recordedOn: '2026-09-04' }),
      ),
    ).toEqual([])
  })

  /**
   * The statutory disqualification, checked against the names actually entered.
   * The comparison is loose because people write names differently; the point
   * is to make someone look.
   */
  it('rejects a proxy witnessed by the person it appoints', () => {
    const [problem] = documentProblems(
      ceremony({ healthCareAgentName: 'Dana Reed' }),
      record({ documentKind: 'health_care_proxy', notarized: false }),
    )
    expect(problem.severity).toBe('invalid')
    expect(problem.message).toMatch(/agent may not witness/i)
  })

  it('catches the agent under a differently written name', () => {
    const problems = documentProblems(
      ceremony({ witnessOneName: '  dana   reed ', healthCareAgentName: 'Dana Reed' }),
      record({ documentKind: 'health_care_proxy', notarized: false }),
    )
    expect(problems.some((p) => /agent may not witness/i.test(p.message))).toBe(true)
  })

  it('does not confuse a different person with a similar name', () => {
    const problems = documentProblems(
      ceremony({ healthCareAgentName: 'Dana Reeds' }),
      record({ documentKind: 'health_care_proxy', notarized: false }),
    )
    expect(problems.some((p) => /agent may not witness/i.test(p.message))).toBe(false)
  })

  it('says nothing about the agent when no proxy was signed', () => {
    expect(
      documentProblems(ceremony({ healthCareAgentName: 'Dana Reed' }), record()),
    ).toEqual([])
  })
})

describe('ceremonyProblems', () => {
  it('is satisfied when every executed document holds up', () => {
    const problems = ceremonyProblems(ceremony(), [
      record(),
      record({ documentKind: 'trust', witnessCount: 0 }),
    ])
    expect(problems).toEqual([])
  })

  it('asks for the witnesses to be named when something needed them', () => {
    const [problem] = ceremonyProblems(
      ceremony({ witnessOneName: null, witnessTwoName: null }),
      [record()],
    )
    // The instrument carries the signatures; the file should say who they were.
    expect(problem.message).toMatch(/who witnessed/i)
    expect(problem.severity).toBe('incomplete')
  })

  it('does not ask for witnesses when nothing signed needed any', () => {
    expect(
      ceremonyProblems(ceremony({ witnessOneName: null, witnessTwoName: null }), [
        record({ documentKind: 'trust', witnessCount: 0 }),
      ]),
    ).toEqual([])
  })

  it('asks who notarised when a document required one', () => {
    const problems = ceremonyProblems(ceremony({ notaryName: null }), [
      record({ documentKind: 'deed', witnessCount: 0, notarized: true, recordedOn: '2026-09-04' }),
    ])
    expect(problems.some((p) => /who notarised/i.test(p.message))).toBe(true)
  })

  it('reports the documents problems alongside the ceremony ones', () => {
    const problems = ceremonyProblems(ceremony({ witnessOneName: null, witnessTwoName: null }), [
      record({ witnessCount: 1 }),
    ])
    expect(problems.some((p) => p.severity === 'invalid')).toBe(true)
    expect(problems.some((p) => p.severity === 'incomplete')).toBe(true)
  })

  it('has nothing to say about a ceremony with nothing recorded', () => {
    expect(ceremonyProblems(ceremony(), [])).toEqual([])
  })
})
