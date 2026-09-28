import { documentLabel, requirementsFor, type DocumentKind } from '@/lib/execution/requirements'

/**
 * Whether the record of a signing says something the law would agree with.
 *
 * Recording an execution is a claim that a document is valid. These checks stop
 * the file from asserting what did not happen — the only error here that cannot
 * be corrected later, because by the time anyone reads the record the client is
 * usually gone and the witnesses are unreachable.
 *
 * Two severities, and the difference matters. `invalid` means the document, as
 * recorded, does not meet its requirements: a will with one witness is not a
 * will. `incomplete` means something true is still outstanding — a deed is good
 * between the parties before it is recorded, and recording happens after the
 * appointment.
 */
export type ProblemSeverity = 'invalid' | 'incomplete'

export interface Problem {
  severity: ProblemSeverity
  documentKind: DocumentKind | null
  message: string
}

export interface CeremonyRoles {
  witnessOneName: string | null
  witnessTwoName: string | null
  notaryName: string | null
  healthCareAgentName: string | null
}

export interface DocumentRecord {
  documentKind: DocumentKind
  executed: boolean
  signedOn: string | null
  witnessCount: number
  notarized: boolean
  recordedOn: string | null
}

/** Loose enough for spacing and case, strict enough not to merge two people. */
function sameName(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  const normalise = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ')
  return normalise(a) === normalise(b)
}

export function documentProblems(roles: CeremonyRoles, record: DocumentRecord): Problem[] {
  // Nothing was claimed, so there is nothing to be wrong.
  if (!record.executed) return []

  const requirement = requirementsFor(record.documentKind)
  const label = documentLabel(record.documentKind)
  const problems: Problem[] = []

  if (record.witnessCount < requirement.witnesses) {
    problems.push({
      severity: 'invalid',
      documentKind: record.documentKind,
      message: `${label} needs ${requirement.witnesses === 2 ? 'two witnesses' : `${requirement.witnesses} witnesses`}; ${record.witnessCount} recorded. ${requirement.citation}.`,
    })
  }

  if (requirement.notary === 'required' && !record.notarized) {
    problems.push({
      severity: 'invalid',
      documentKind: record.documentKind,
      message: `${label} must be acknowledged before a notary. ${requirement.citation}.`,
    })
  }

  /**
   * The statutory disqualification, checked against the names actually typed.
   * The comparison will miss a differently spelled name, which is why the form
   * asks who the agent is at all — making someone look is most of the check.
   */
  if (record.documentKind === 'health_care_proxy') {
    const agent = roles.healthCareAgentName
    if (sameName(agent, roles.witnessOneName) || sameName(agent, roles.witnessTwoName)) {
      problems.push({
        severity: 'invalid',
        documentKind: record.documentKind,
        message: `The health care agent may not witness the proxy that appoints them. ${requirement.citation}.`,
      })
    }
  }

  if (requirement.recording && !record.recordedOn) {
    problems.push({
      severity: 'incomplete',
      documentKind: record.documentKind,
      message: `${label} has not been recorded. Until it is, it does not bind anyone who comes later — ${requirement.recording}.`,
    })
  }

  return problems
}

/**
 * Everything wrong with the record of one appointment.
 *
 * The ceremony-level checks ask for the people to be named. The instrument
 * itself carries the signatures, so this is not what makes anything valid — it
 * is what lets the firm answer, years later, who was in the room.
 */
export function ceremonyProblems(
  roles: CeremonyRoles,
  records: readonly DocumentRecord[],
): Problem[] {
  const executed = records.filter((record) => record.executed)
  const problems = records.flatMap((record) => documentProblems(roles, record))

  const needsWitnesses = executed.some((record) => requirementsFor(record.documentKind).witnesses > 0)
  if (needsWitnesses && !(roles.witnessOneName && roles.witnessTwoName)) {
    problems.push({
      severity: 'incomplete',
      documentKind: null,
      message: 'Record who witnessed. The signatures are on the instrument; this is how the file answers the question later.',
    })
  }

  const needsNotary = executed.some((record) => record.notarized)
  if (needsNotary && !roles.notaryName) {
    problems.push({
      severity: 'incomplete',
      documentKind: null,
      message: 'Record who notarised.',
    })
  }

  return problems
}
