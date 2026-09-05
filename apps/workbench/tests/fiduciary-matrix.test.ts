import { describe, expect, it } from 'vitest'
import {
  FIDUCIARY_ROLES,
  buildMatrix,
  matrixIssues,
  roleLabel,
} from '@/lib/fiduciary/matrix'

const appointment = (over: Partial<Parameters<typeof buildMatrix>[0][number]> = {}) => ({
  contactId: 'c-1',
  name: 'Jane Smith',
  role: 'trustee' as const,
  forParty: 'client' as const,
  priority: 1,
  isCoagent: false,
  ...over,
})

describe('roles', () => {
  it('covers the five the firm appoints', () => {
    expect([...FIDUCIARY_ROLES]).toEqual(['trustee', 'personal_rep', 'poa', 'hcp', 'guardian'])
  })

  it('names each one the way an attorney says it', () => {
    expect(roleLabel('hcp')).toBe('Health care agent')
    expect(roleLabel('poa')).toBe('Attorney-in-fact')
    expect(roleLabel('personal_rep')).toBe('Personal representative')
  })
})

describe('buildMatrix', () => {
  it('puts each role in the order the people would actually serve', () => {
    const matrix = buildMatrix([
      appointment({ contactId: 'c-2', name: 'Robert Smith', priority: 2 }),
      appointment({ priority: 1 }),
    ])
    const chain = matrix.chains.find((c) => c.role === 'trustee' && c.forParty === 'client')
    expect(chain?.people.map((p) => p.name)).toEqual(['Jane Smith', 'Robert Smith'])
  })

  it('keeps a client and a spouse chain apart, since they appoint separately', () => {
    const matrix = buildMatrix([
      appointment({ forParty: 'client' }),
      appointment({ contactId: 'c-3', name: 'Pat Doe', forParty: 'spouse' }),
    ])
    expect(matrix.chains).toHaveLength(2)
    expect(matrix.chains.map((c) => c.forParty).sort()).toEqual(['client', 'spouse'])
  })

  /**
   * The cross-document view is the point: one person appearing in five roles is
   * invisible while each document is read on its own.
   */
  it('shows every role one person holds', () => {
    const matrix = buildMatrix([
      appointment({ role: 'trustee' }),
      appointment({ role: 'personal_rep' }),
      appointment({ role: 'hcp' }),
    ])
    const jane = matrix.people.find((p) => p.contactId === 'c-1')
    expect(jane?.appointments.map((a) => a.role).sort()).toEqual(['hcp', 'personal_rep', 'trustee'])
  })

  it('counts one person once, however many roles they hold', () => {
    const matrix = buildMatrix([appointment({ role: 'trustee' }), appointment({ role: 'poa' })])
    expect(matrix.people).toHaveLength(1)
  })

  it('marks a co-agent, because co-agents usually have to act together', () => {
    const matrix = buildMatrix([appointment({ isCoagent: true })])
    expect(matrix.chains[0].people[0].isCoagent).toBe(true)
  })

  it('has nothing to show for a matter with no appointments', () => {
    expect(buildMatrix([])).toEqual({ chains: [], people: [] })
  })
})

describe('matrixIssues', () => {
  const withMinors = { minorChildren: 2 }

  /**
   * The most common gap in the live data, and the one that matters: a first
   * choice with nobody behind them. If that person dies, declines or is
   * unreachable, the appointment fails and a court fills it.
   */
  it('flags a role with a first choice and no successor', () => {
    const issues = matrixIssues(buildMatrix([appointment()]), { minorChildren: 0 })
    const issue = issues.find((i) => i.kind === 'no_successor')
    expect(issue?.severity).toBe('gap')
    expect(issue?.message).toMatch(/no successor/i)
    expect(issue?.message).toMatch(/trustee/i)
  })

  it('is satisfied once a successor is named', () => {
    const matrix = buildMatrix([
      appointment({ priority: 1 }),
      appointment({ contactId: 'c-2', name: 'Robert Smith', priority: 2 }),
    ])
    expect(matrixIssues(matrix, { minorChildren: 0 }).filter((i) => i.kind === 'no_successor')).toEqual([])
  })

  it('does not count a co-agent as the successor', () => {
    // Co-agents serve together at the same level; neither backs the other up.
    const matrix = buildMatrix([
      appointment({ priority: 1 }),
      appointment({ contactId: 'c-2', name: 'Robert Smith', priority: 1, isCoagent: true }),
    ])
    expect(matrixIssues(matrix, { minorChildren: 0 }).some((i) => i.kind === 'no_successor')).toBe(true)
  })

  /**
   * A family with minor children and no guardian leaves the choice to a judge
   * who never met them. It is the highest-consequence omission on this screen.
   */
  it('flags minor children with no guardian named', () => {
    const issues = matrixIssues(buildMatrix([appointment({ role: 'trustee' })]), withMinors)
    const issue = issues.find((i) => i.kind === 'no_guardian')
    expect(issue?.severity).toBe('gap')
    expect(issue?.message).toMatch(/minor children/i)
  })

  it('says nothing about a guardian when there are no minor children', () => {
    const issues = matrixIssues(buildMatrix([appointment()]), { minorChildren: 0 })
    expect(issues.some((i) => i.kind === 'no_guardian')).toBe(false)
  })

  it('is satisfied when a guardian is named', () => {
    const matrix = buildMatrix([appointment({ role: 'guardian' })])
    expect(matrixIssues(matrix, withMinors).some((i) => i.kind === 'no_guardian')).toBe(false)
  })

  /**
   * Not an error — a spouse holding every role is the normal shape of a plan.
   * It is worth seeing, because it means one death or illness empties every
   * office at once.
   */
  it('notes when one person holds every role, without calling it wrong', () => {
    const matrix = buildMatrix(
      FIDUCIARY_ROLES.map((role) => appointment({ role, priority: 1 })),
    )
    const issue = matrixIssues(matrix, { minorChildren: 0 }).find((i) => i.kind === 'concentrated')
    expect(issue?.severity).toBe('note')
    expect(issue?.message).toMatch(/every role/i)
  })

  it('does not call two roles a concentration', () => {
    const matrix = buildMatrix([appointment({ role: 'trustee' }), appointment({ role: 'poa' })])
    expect(matrixIssues(matrix, { minorChildren: 0 }).some((i) => i.kind === 'concentrated')).toBe(false)
  })

  /**
   * A data error rather than a drafting one: the same person cannot be both
   * first and second choice for the same office.
   */
  it('flags one person appearing twice in the same chain', () => {
    const matrix = buildMatrix([appointment({ priority: 1 }), appointment({ priority: 2 })])
    const issue = matrixIssues(matrix, { minorChildren: 0 }).find((i) => i.kind === 'duplicate')
    expect(issue?.severity).toBe('error')
    expect(issue?.message).toMatch(/twice/i)
  })

  it('has nothing to say about a matter with no appointments at all', () => {
    // Nothing recorded is a matter not yet designed, not a matter with gaps.
    expect(matrixIssues(buildMatrix([]), { minorChildren: 0 })).toEqual([])
  })
})
