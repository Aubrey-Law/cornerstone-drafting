/**
 * Who holds which office, across every document at once.
 *
 * Each instrument names its own fiduciaries, so reading them one at a time
 * hides the two things worth knowing: that one person quietly holds every
 * office, and that an office has a first choice and nobody behind them. The
 * second is the common one — in the live data most roles have a first
 * appointment and no alternate — and it is the one that fails silently, because
 * nothing goes wrong until the person named cannot serve.
 *
 * Pure, so the rules are a table in a test rather than a query.
 */

export const FIDUCIARY_ROLES = ['trustee', 'personal_rep', 'poa', 'hcp', 'guardian'] as const
export type FiduciaryRole = (typeof FIDUCIARY_ROLES)[number]

export type ForParty = 'client' | 'spouse'

const ROLE_LABELS: Record<FiduciaryRole, string> = {
  trustee: 'Trustee',
  personal_rep: 'Personal representative',
  poa: 'Attorney-in-fact',
  hcp: 'Health care agent',
  guardian: 'Guardian',
}

export function roleLabel(role: FiduciaryRole): string {
  return ROLE_LABELS[role] ?? role
}

export interface Appointment {
  contactId: string
  name: string
  role: FiduciaryRole
  forParty: ForParty
  priority: number
  /** Co-agents serve together at one level; neither is the other's successor. */
  isCoagent: boolean
}

export interface RoleChain {
  role: FiduciaryRole
  forParty: ForParty
  people: Appointment[]
}

export interface Person {
  contactId: string
  name: string
  appointments: Appointment[]
}

export interface Matrix {
  chains: RoleChain[]
  people: Person[]
}

export function buildMatrix(appointments: readonly Appointment[]): Matrix {
  const chains = new Map<string, RoleChain>()
  const people = new Map<string, Person>()

  for (const appointment of appointments) {
    const key = `${appointment.role}:${appointment.forParty}`
    const chain = chains.get(key)
    if (chain) chain.people.push(appointment)
    else chains.set(key, { role: appointment.role, forParty: appointment.forParty, people: [appointment] })

    const person = people.get(appointment.contactId)
    if (person) person.appointments.push(appointment)
    else
      people.set(appointment.contactId, {
        contactId: appointment.contactId,
        name: appointment.name,
        appointments: [appointment],
      })
  }

  for (const chain of chains.values()) {
    chain.people.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))
  }

  return {
    chains: [...chains.values()].sort(
      (a, b) =>
        FIDUCIARY_ROLES.indexOf(a.role) - FIDUCIARY_ROLES.indexOf(b.role) ||
        a.forParty.localeCompare(b.forParty),
    ),
    people: [...people.values()].sort((a, b) => b.appointments.length - a.appointments.length || a.name.localeCompare(b.name)),
  }
}

export type IssueKind = 'no_successor' | 'no_guardian' | 'concentrated' | 'duplicate'
export type IssueSeverity = 'error' | 'gap' | 'note'

export interface MatrixIssue {
  kind: IssueKind
  severity: IssueSeverity
  message: string
}

export interface MatterFacts {
  minorChildren: number
}

const partyLabel = (party: ForParty) => (party === 'client' ? 'the client' : 'the spouse')

/**
 * What is wrong, or worth knowing, about the appointments as they stand.
 *
 * Three severities, and the difference is the point. `error` is a
 * contradiction in the record. `gap` is a real hole in the plan that will only
 * show itself when someone cannot serve. `note` is a shape worth seeing that is
 * not wrong at all — a spouse holding every office is the normal design of a
 * plan, and calling it a fault would teach the reader to ignore this list.
 */
export function matrixIssues(matrix: Matrix, facts: MatterFacts): MatrixIssue[] {
  const issues: MatrixIssue[] = []
  if (matrix.chains.length === 0) return issues

  for (const chain of matrix.chains) {
    const successors = chain.people.filter((person) => !person.isCoagent && person.priority > 1)
    if (chain.people.length > 0 && successors.length === 0) {
      issues.push({
        kind: 'no_successor',
        severity: 'gap',
        message: `${roleLabel(chain.role)} for ${partyLabel(chain.forParty)} has no successor. If ${chain.people[0].name} cannot serve, the office is empty and a court fills it.`,
      })
    }

    const seen = new Set<string>()
    for (const person of chain.people) {
      if (seen.has(person.contactId)) {
        issues.push({
          kind: 'duplicate',
          severity: 'error',
          message: `${person.name} appears twice in the ${roleLabel(chain.role).toLowerCase()} chain for ${partyLabel(chain.forParty)}. One person cannot be both their own successor.`,
        })
      }
      seen.add(person.contactId)
    }
  }

  const hasGuardian = matrix.chains.some((chain) => chain.role === 'guardian' && chain.people.length > 0)
  if (facts.minorChildren > 0 && !hasGuardian) {
    issues.push({
      kind: 'no_guardian',
      severity: 'gap',
      message: `There are minor children and no guardian is named. The choice falls to a judge who never met the family.`,
    })
  }

  for (const person of matrix.people) {
    const roles = new Set(person.appointments.map((a) => a.role))
    if (roles.size === FIDUCIARY_ROLES.length) {
      issues.push({
        kind: 'concentrated',
        severity: 'note',
        message: `${person.name} holds every role. That is a normal plan, and it means one illness empties every office at once.`,
      })
    }
  }

  return issues
}
