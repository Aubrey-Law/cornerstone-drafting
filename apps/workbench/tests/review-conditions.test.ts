import { describe, expect, it } from 'vitest'
import {
  deriveMatterFacts,
  evaluateConditions,
  parseMatterFacts,
  ruleConditionSchema,
  type MatterFacts,
} from '@aubrey-law/citations/review/conditions'
import { runReviewPlaybook, REVIEW_TOOL_NAME } from '@aubrey-law/citations/review/runReview'
import { reviewBodySchema } from '@aubrey-law/citations/prompt/body'
import type { ModelResponse } from '@aubrey-law/citations/review/model'
import type { TextLayer } from '@aubrey-law/citations/textLayer/types'

const NO_FACTS: MatterFacts = deriveMatterFacts({})

describe('deriveMatterFacts', () => {
  it('reads a new, unworked sheet as knowing nothing', () => {
    // `children: []` and `is_joint: false` are the defaults, not answers.
    expect(deriveMatterFacts({ children: [], is_joint: false, assets: [], marital_status: null })).toEqual({
      married: null,
      joint_plan: null,
      has_minor_children: null,
      has_business_interest: null,
      owns_real_property: null,
      plan_type: null,
      estimated_estate_value: null,
    })
  })

  it('derives answers only from what the sheet records', () => {
    const facts = deriveMatterFacts({
      marital_status: 'Remarried',
      is_joint: false,
      plan_type: 'pour_over',
      children: [{ name: 'A', is_minor: false }, { name: 'B', is_minor: true }],
      assets: [
        { category: 'real_property', estimated_value: 900_000 },
        { category: 'financial', estimated_value: null },
      ],
    })
    expect(facts).toMatchObject({
      married: true,
      joint_plan: false,
      has_minor_children: true,
      owns_real_property: true,
      has_business_interest: false,
      plan_type: 'pour_over',
      estimated_estate_value: { total: 900_000, complete: false },
    })
    expect(deriveMatterFacts({ marital_status: 'never married' }).married).toBe(false)
  })

  it('round-trips through resolved_inputs, and treats junk as no facts', () => {
    const facts = deriveMatterFacts({ marital_status: 'married' })
    expect(parseMatterFacts(JSON.parse(JSON.stringify({ matterFacts: facts })))).toEqual(facts)
    expect(parseMatterFacts(null)).toBeNull()
    expect(parseMatterFacts({ values: {} })).toBeNull()
  })
})

describe('evaluateConditions', () => {
  const minors = [{ fact: 'has_minor_children' as const, test: 'is' as const, value: true }]

  it('skips only on a definite no', () => {
    expect(evaluateConditions(minors, { ...NO_FACTS, has_minor_children: false }).status).toBe('not_met')
    expect(evaluateConditions(minors, NO_FACTS).status).toBe('unknown')
    expect(evaluateConditions(minors, { ...NO_FACTS, has_minor_children: true }).status).toBe('applies')
    expect(evaluateConditions(minors, null).status).toBe('applies')
    expect(evaluateConditions(undefined, NO_FACTS).status).toBe('applies')
  })

  it('treats a partial estate total as a lower bound', () => {
    const over = [{ fact: 'estimated_estate_value' as const, test: 'at_least' as const, value: 2_000_000 }]
    const estate = (total: number, complete: boolean): MatterFacts => ({
      ...NO_FACTS,
      estimated_estate_value: { total, complete },
    })
    expect(evaluateConditions(over, estate(2_500_000, false)).status).toBe('applies')
    expect(evaluateConditions(over, estate(1_500_000, false)).status).toBe('unknown')
    expect(evaluateConditions(over, estate(1_500_000, true)).status).toBe('not_met')
  })

  it('refuses a condition that tests a fact the wrong way', () => {
    expect(ruleConditionSchema.safeParse({ fact: 'married', test: 'at_least', value: 3 }).success).toBe(false)
    expect(ruleConditionSchema.safeParse({ fact: 'net_worth', test: 'is', value: true }).success).toBe(false)
    expect(ruleConditionSchema.safeParse({ fact: 'plan_type', test: 'one_of', value: ['pour_over'] }).success).toBe(true)
  })

  it('still parses a body published before conditions existed', () => {
    const body = { kind: 'review', inputs: [], rules: [{ number: '1', risk: 'high', statement: 'x' }] }
    expect(reviewBodySchema.parse(body)).toEqual(body)
  })
})

describe('runReviewPlaybook with matter facts', () => {
  const TEXT = 'The Trustee shall serve without bond.'
  const layer: TextLayer = {
    sourceKind: 'docx',
    status: 'ok',
    extractor: 'test',
    extractorVersion: '1',
    sourceSha256: 'a'.repeat(64),
    pageCount: null,
    text: TEXT,
    blocks: [{ index: 0, charStart: 0, charEnd: TEXT.length, text: TEXT, page: null, bbox: null }],
    spans: [],
  }
  const playbook = {
    slug: 't',
    title: 'T',
    version: 1,
    rules: [
      { number: '1', risk: 'high' as const, statement: 'Guardians are named.', conditions: [{ fact: 'has_minor_children' as const, test: 'is' as const, value: true }] },
      { number: '2', risk: 'medium' as const, statement: 'Bond is waived.' },
    ],
  }

  it('answers a ruled-out rule without a model call, records it, and keeps playbook order', async () => {
    const called: string[] = []
    const settled: string[] = []
    const result = await runReviewPlaybook(layer, playbook, {
      matterFacts: { ...NO_FACTS, has_minor_children: false },
      onUnitSettled: async (unitId) => {
        settled.push(unitId)
      },
      callModel: async (request) => {
        called.push(String(request.messages[0].content))
        return {
          content: [
            {
              type: 'tool_use',
              name: REVIEW_TOOL_NAME,
              id: 'x',
              input: { outcome: 'compliant', rationale: 'ok', quote: 'without bond', block_index: 0, proposed_language: null },
            },
          ],
        } as unknown as ModelResponse
      },
    })

    expect(called).toHaveLength(1)
    expect(called[0]).toContain('Rule 2')
    expect(settled).toEqual(['1', '2'])
    expect(result.findings.map((f) => [f.ruleNumber, f.outcome])).toEqual([
      ['1', 'not_applicable'],
      ['2', 'compliant'],
    ])
    expect(result.findings[0].rationale).toMatch(/only when has minor children/)
  })

  it('runs a conditional rule when the fact is not recorded', async () => {
    let calls = 0
    await runReviewPlaybook(layer, playbook, {
      matterFacts: NO_FACTS,
      callModel: async () => {
        calls += 1
        return { content: [] } as unknown as ModelResponse
      },
    })
    expect(calls).toBe(2)
  })
})
