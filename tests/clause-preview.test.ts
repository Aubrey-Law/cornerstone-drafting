import { describe, expect, it } from 'vitest'
import { buildClausePreviews } from '@/lib/estateGenerator/clausePreview'
import { buildNodeEstateContext } from '@/lib/estateGenerator/node/context'
import type { NodeEstateContext } from '@/lib/estateGenerator/node/types'

function context(overrides: Record<string, unknown> = {}): NodeEstateContext {
  return {
    uses_revocable_trust: true,
    includes_pour_over_will: true,
    includes_simple_will: false,
    includes_dpoa: true,
    includes_hcp: true,
    includes_hipaa: true,
    distributes_to_descendants: true,
    dpoa_gifting_authorized: true,
    requires_guardian_clause: true,
    has_co_poa: false,
    co_poa_joint: false,
    co_poa_majority: false,
    hipaa_include_poa: true,
    hipaa_include_trustees: false,
    hipaa_list_fiduciaries_by_name: false,
    hipaa_list_fiduciaries_general: false,
    owns_real_property: true,
    client: { full_name: 'Alex Client' },
    trust: {
      display_name: 'The Client Trust',
      descendants_distribution: { method: 'staggered' },
    },
    pour_over: { alternate_disposition: 'descendants_per_stirpes' },
    outright_will: { residuary: {} },
    dpoa: {},
    healthcare: { agent: { primary: { full_name: 'Harper Agent' }, alternate: { full_name: '' } } },
    hipaa: { client_additional_agents: [] },
    assets: { total_gross_value: '$500,000' },
    guardians: { primary: { full_name: '' }, successor: { full_name: '' } },
    fiduciaries: {
      trustee: {
        primary: { full_name: 'Alex Client' },
        successor: { full_name: '' },
        second_successor: { full_name: '' },
      },
      executor: {
        primary: { full_name: 'Morgan Representative' },
        successor: { full_name: '' },
      },
      agent: {
        primary: { full_name: 'Taylor Agent' },
        co_primary: { full_name: '' },
        successor: { full_name: '' },
      },
    },
    ...overrides,
  } as unknown as NodeEstateContext
}

describe('clause preview', () => {
  it('derives preview conditionals in the node estate context', () => {
    const built = buildNodeEstateContext({
      state: 'MA',
      data: {
        planning: {
          uses_revocable_trust: true,
          include_pour_over_will: true,
          include_dpoa: true,
        },
        trust: { descendants_distribution: { method: 'staggered' } },
        dpoa: { allow_gifts: true },
      },
    })

    expect(built.uses_revocable_trust).toBe(true)
    expect(built.includes_pour_over_will).toBe(true)
    expect(built.distributes_to_descendants).toBe(true)
    expect(built.dpoa_gifting_authorized).toBe(true)
  })

  it('renders required missing values as holes and optional alternates as annotations', () => {
    const clauses = buildClausePreviews(context())
    const guardian = clauses.find(clause => clause.id === 'guardian')
    const trustee = clauses.find(clause => clause.id === 'successor-trustee')

    expect(guardian?.parts).toContainEqual({ kind: 'hole', label: 'guardian' })
    expect(trustee?.parts).toContainEqual({ kind: 'hole', label: 'successor trustee' })
    expect(trustee?.annotation).toBeUndefined()
  })

  it('uses named context flags to choose conditional clause language', () => {
    const clauses = buildClausePreviews(context({
      has_co_poa: true,
      co_poa_joint: true,
      co_poa_majority: false,
      fiduciaries: {
        trustee: { primary: { full_name: 'A' }, successor: { full_name: 'B' } },
        executor: { primary: { full_name: 'C' }, successor: { full_name: 'D' } },
        agent: {
          primary: { full_name: 'E' },
          co_primary: { full_name: 'F' },
          successor: { full_name: 'G' },
        },
      },
    }))
    const poa = clauses.find(clause => clause.id === 'poa-appointment')

    expect(poa?.parts).toContainEqual({
      kind: 'text',
      text: ' to act jointly as my Attorneys-in-Fact.',
    })
  })
})
