import type { NodeEstateContext } from './node/types'

export type ClausePreviewPart =
  | { kind: 'text'; text: string }
  | { kind: 'value'; text: string }
  | { kind: 'hole'; label: string }

export interface ClausePreviewClause {
  id: string
  document: string
  section: string
  parts: ClausePreviewPart[]
  annotation?: string
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function person(container: unknown, key: string): string {
  return text(record(record(container)[key]).full_name)
}

function literal(value: string): ClausePreviewPart {
  return { kind: 'text', text: value }
}

function required(value: string, label: string): ClausePreviewPart {
  return value ? { kind: 'value', text: value } : { kind: 'hole', label }
}

function optionalLine(primary: string, alternate: string, role: string): string | undefined {
  return primary && !alternate ? `${role} has a primary nominee but no alternate.` : undefined
}

export function buildClausePreviews(context: NodeEstateContext): ClausePreviewClause[] {
  const fiduciaries = record(context.fiduciaries)
  const trustee = record(fiduciaries.trustee)
  const executor = record(fiduciaries.executor)
  const agent = record(fiduciaries.agent)
  const healthcare = record(context.healthcare)
  const healthcareAgent = record(healthcare.agent)
  const guardians = record(context.guardians)
  const trust = record(context.trust)
  const descendants = record(trust.descendants_distribution)
  const pourOver = record(context.pour_over)
  const outrightWill = record(context.outright_will)
  const residuary = record(outrightWill.residuary)
  const hipaa = record(context.hipaa)
  const assets = record(context.assets)
  const trusteePrimary = person(trustee, 'primary')
  const trusteeSuccessor = person(trustee, 'successor')
  const trusteeSecondSuccessor = person(trustee, 'second_successor')
  const executorPrimary = person(executor, 'primary')
  const executorSuccessor = person(executor, 'successor')
  const guardianPrimary = person(guardians, 'primary')
  const guardianSuccessor = person(guardians, 'successor')
  const agentPrimary = person(agent, 'primary')
  const agentSuccessor = person(agent, 'successor')
  const healthcarePrimary = person(healthcareAgent, 'primary')
  const healthcareAlternate = person(healthcareAgent, 'alternate')
  const clauses: ClausePreviewClause[] = []

  if (context.uses_revocable_trust) {
    clauses.push({
      id: 'successor-trustee',
      document: 'Revocable Trust',
      section: 'Trustee Succession',
      parts: [
        literal('If '),
        required(trusteePrimary, 'initial trustee'),
        literal(' ceases to serve, '),
        required(trusteeSuccessor, 'successor trustee'),
        literal(' shall serve as successor Trustee.'),
      ],
      annotation: optionalLine(trusteeSuccessor, trusteeSecondSuccessor, 'Successor trustee nomination'),
    })
  }

  clauses.push({
    id: 'personal-representative',
    document: context.includes_pour_over_will ? 'Pour-Over Will' : 'Last Will and Testament',
    section: 'Personal Representative',
    parts: [
      literal('I nominate '),
      required(executorPrimary, 'personal representative'),
      literal(' to serve as Personal Representative of my estate.'),
    ],
    annotation: optionalLine(executorPrimary, executorSuccessor, 'Personal representative'),
  })

  if (context.requires_guardian_clause) {
    clauses.push({
      id: 'guardian',
      document: 'Last Will and Testament',
      section: 'Guardian Nomination',
      parts: [
        literal('I nominate '),
        required(guardianPrimary, 'guardian'),
        literal(' as guardian of each minor child of mine.'),
      ],
      annotation: optionalLine(guardianPrimary, guardianSuccessor, 'Guardian nomination'),
    })
  }

  if (context.includes_dpoa) {
    const coAgent = person(agent, 'co_primary')
    clauses.push({
      id: 'poa-appointment',
      document: 'Durable Power of Attorney',
      section: 'Appointment of Attorney-in-Fact',
      parts: context.has_co_poa
        ? [
            literal('I appoint '),
            required(agentPrimary, 'financial agent'),
            literal(' and '),
            required(coAgent, 'co-agent'),
            literal(context.co_poa_joint
              ? ' to act jointly as my Attorneys-in-Fact.'
              : context.co_poa_majority
                ? ' to act by majority as my Attorneys-in-Fact.'
                : ' to act independently as my Attorneys-in-Fact.'),
          ]
        : [
            literal('I appoint '),
            required(agentPrimary, 'financial agent'),
            literal(' as my Attorney-in-Fact.'),
          ],
      annotation: optionalLine(agentPrimary, agentSuccessor, 'Financial agent appointment'),
    })
  }

  if (context.includes_hcp) {
    clauses.push({
      id: 'health-care-agent',
      document: 'Health Care Proxy',
      section: 'Appointment of Health Care Agent',
      parts: [
        literal('I appoint '),
        required(healthcarePrimary, 'health care agent'),
        literal(' as my Health Care Agent.'),
      ],
      annotation: optionalLine(healthcarePrimary, healthcareAlternate, 'Health care agent appointment'),
    })
  }

  if (context.uses_revocable_trust && context.distributes_to_descendants) {
    const method = text(descendants.method)
    const methodLabel = method === 'outright' ? 'outright'
      : method === 'staggered' ? 'in staged distributions'
        : method.replaceAll('_', ' ')
    clauses.push({
      id: 'descendants-distribution',
      document: 'Revocable Trust',
      section: 'Distribution to Descendants',
      parts: [
        literal('The remaining trust estate shall be distributed to my descendants, per stirpes, '),
        required(methodLabel, 'distribution method'),
        literal('.'),
      ],
    })
  }

  const disposition = context.uses_revocable_trust
    ? text(pourOver.alternate_disposition)
    : text(residuary.disposition)
  clauses.push({
    id: 'ultimate-residuary',
    document: context.uses_revocable_trust ? 'Pour-Over Will' : 'Last Will and Testament',
    section: 'Ultimate Residuary',
    parts: [
      literal('I direct that the residue be distributed to '),
      required(disposition.replaceAll('_', ' '), 'residuary disposition'),
      literal('.'),
    ],
  })

  if (context.includes_dpoa) {
    clauses.push({
      id: 'gifting-powers',
      document: 'Durable Power of Attorney',
      section: 'Gifting Powers',
      parts: [
        literal(context.dpoa_gifting_authorized
          ? 'My Attorney-in-Fact may make gifts on my behalf as authorized in this instrument.'
          : 'My Attorney-in-Fact has no authority to make gifts on my behalf.'),
      ],
    })
  }

  if (context.includes_hipaa) {
    const recipients = [
      context.hipaa_include_poa ? 'my Attorneys-in-Fact' : '',
      context.hipaa_include_trustees ? 'my Trustees' : '',
      context.hipaa_list_fiduciaries_by_name ? 'the fiduciaries named in this authorization' : '',
      context.hipaa_list_fiduciaries_general ? 'the fiduciaries serving for me from time to time' : '',
    ].filter(Boolean).join(', ')
    const additional = Array.isArray(hipaa.client_additional_agents)
      ? hipaa.client_additional_agents.map(entry => text(record(entry).full_name)).filter(Boolean).join(', ')
      : ''
    clauses.push({
      id: 'hipaa-recipients',
      document: 'HIPAA Authorization',
      section: 'Authorized Recipients',
      parts: [
        literal('I authorize disclosure of my protected health information to '),
        required([recipients, additional].filter(Boolean).join(', '), 'authorized recipients'),
        literal('.'),
      ],
    })
  }

  if (context.owns_real_property) {
    clauses.push({
      id: 'deed-granting',
      document: 'Deed',
      section: 'Granting Clause',
      parts: [
        required(text(record(context.client).full_name), 'grantor'),
        literal(' grants the real property described in this deed to the trustee of '),
        required(text(trust.display_name) || text(trust.name), 'trust name'),
        literal('.'),
      ],
      annotation: !text(assets.total_gross_value)
        ? 'The deed is valid for preview, but the asset schedule does not include a gross value.'
        : undefined,
    })
  }

  return clauses
}
