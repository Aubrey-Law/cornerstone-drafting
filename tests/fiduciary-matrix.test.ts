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

describe('issue identity', () => {
  /**
   * A task's `batch_tag` is built from these rather than from `message`,
   * which embeds people's names — keyed off the message, renaming a contact
   * would read as a new issue: the old task orphaned, a duplicate created,
   * and the attorney's place in it lost.
   */
  it('names the role and party a chain issue belongs to', () => {
    const matrix = buildMatrix([appointment()])
    const issue = matrixIssues(matrix, { minorChildren: 0 }).find((i) => i.kind === 'no_successor')
    expect(issue).toBeDefined()
    expect(issue!.role).toBe(appointment().role)
    expect(issue!.forParty).toBe(appointment().forParty)
  })

  it('names the role and party a duplicate belongs to', () => {
    const matrix = buildMatrix([
      appointment({ forParty: 'spouse', priority: 1 }),
      appointment({ forParty: 'spouse', priority: 2 }),
    ])
    const issue = matrixIssues(matrix, { minorChildren: 0 }).find((i) => i.kind === 'duplicate')
    expect(issue).toBeDefined()
    expect(issue!.role).toBe('trustee')
    expect(issue!.forParty).toBe('spouse')
  })

  /**
   * A missing guardian is named by the office it is missing from, not by a
   * chain — there is no guardian chain to read it off, that being the whole
   * complaint. The party is null because minor children belong to the couple:
   * one guardian gap per matter, not one per spouse.
   */
  it('names the office a missing guardian belongs to, with no party', () => {
    const matrix = buildMatrix([appointment({ role: 'trustee' })])
    const issue = matrixIssues(matrix, { minorChildren: 2 }).find((i) => i.kind === 'no_guardian')
    expect(issue).toBeDefined()
    expect(issue!.role).toBe('guardian')
    expect(issue!.forParty).toBeNull()
  })

  /**
   * `concentrated` is about a person across every chain, not one chain, so it
   * has no role to name. It is also the one issue that never becomes a task,
   * so it never needs a tag — but the type must still admit it, and the
   * emitter refuses to build a tag without one rather than writing
   * `fiduciary:...#concentrated:undefined:undefined`.
   */
  it('leaves role and party null for an issue about a person, not a chain', () => {
    const matrix = buildMatrix(FIDUCIARY_ROLES.map((role) => appointment({ role, priority: 1 })))
    const concentrated = matrixIssues(matrix, { minorChildren: 0 }).find((i) => i.kind === 'concentrated')
    expect(concentrated).toBeDefined()
    expect(concentrated!.role).toBeNull()
    expect(concentrated!.forParty).toBeNull()
  })
})
