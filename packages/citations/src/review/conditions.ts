import { z } from 'zod'

/**
 * Matter conditions on review rules.
 *
 * A rule can say when it applies — "only when the client has minor children",
 * "only for a pour-over plan", "only when the estate is at least $2,000,000" —
 * and a review of a document filed on a matter skips it, without a model call,
 * when the matter's design sheet says the condition is not met.
 *
 * Two decisions shape everything here:
 *
 * - **Conditions name facts, not columns.** A fact is a named, derived answer
 *   (`has_minor_children`) with one definition in `deriveMatterFacts`. A rule
 *   author picks from `MATTER_FACTS`; they cannot point a condition at any
 *   column they like, for the reason `prompt/inputs.ts` keeps an allow-list.
 * - **Only a definite "no" skips a rule.** Every fact is three-valued, and
 *   unknown is the common case: a new design sheet starts with `children: []`
 *   and `is_joint: false` before anyone has asked, so an empty list is not an
 *   answer. A skipped rule is a check that silently never ran, which is the
 *   expensive mistake; a rule that runs on a matter it didn't need to costs one
 *   call and comes back `not_applicable`. When in doubt, it runs.
 */

export const MATTER_FACTS = {
  married: { label: 'Client is married', kind: 'boolean' },
  joint_plan: { label: 'Joint plan for a couple', kind: 'boolean' },
  has_minor_children: { label: 'Has minor children', kind: 'boolean' },
  has_business_interest: { label: 'Owns a business interest', kind: 'boolean' },
  owns_real_property: { label: 'Owns real estate', kind: 'boolean' },
  plan_type: {
    label: 'Plan type',
    kind: 'choice',
    options: [
      { value: 'pour_over', label: 'Pour-over will + revocable trust' },
      { value: 'outright_will', label: 'Will — outright distributions' },
      { value: 'testamentary_trust', label: 'Will — testamentary trust' },
    ],
  },
  estimated_estate_value: { label: 'Estimated estate value', kind: 'number' },
} as const

export type MatterFactKey = keyof typeof MATTER_FACTS

const FACT_KEYS = Object.keys(MATTER_FACTS) as [MatterFactKey, ...MatterFactKey[]]

export const ruleConditionSchema = z
  .discriminatedUnion('test', [
    z.object({ fact: z.enum(FACT_KEYS), test: z.literal('is'), value: z.boolean() }),
    z.object({ fact: z.enum(FACT_KEYS), test: z.literal('one_of'), value: z.array(z.string().min(1)).min(1) }),
    z.object({ fact: z.enum(FACT_KEYS), test: z.literal('at_least'), value: z.number().nonnegative() }),
  ])
  .superRefine((condition, ctx) => {
    const kind = MATTER_FACTS[condition.fact].kind
    const expected = condition.test === 'is' ? 'boolean' : condition.test === 'one_of' ? 'choice' : 'number'
    if (kind !== expected) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `"${condition.fact}" is a ${kind} fact and cannot be tested with "${condition.test}"`,
      })
    }
  })

export type RuleCondition = z.infer<typeof ruleConditionSchema>

/**
 * What the design sheet says, fact by fact. `null` is "not recorded" — never
 * "no". The estate value carries whether every asset had a value, because a
 * partial sum is still a lower bound: it can prove "at least $2M", never
 * "under $2M".
 */
export interface MatterFacts {
  married: boolean | null
  joint_plan: boolean | null
  has_minor_children: boolean | null
  has_business_interest: boolean | null
  owns_real_property: boolean | null
  plan_type: string | null
  estimated_estate_value: { total: number; complete: boolean } | null
}

/** The design-sheet columns `deriveMatterFacts` reads, for the caller's select. */
export const MATTER_FACT_COLUMNS = 'marital_status, is_joint, children, plan_type, assets'

const PLAN_TYPES = MATTER_FACTS.plan_type.options.map(option => option.value) as string[]

function list(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null) : []
}

export function deriveMatterFacts(sheet: Record<string, unknown> | null | undefined): MatterFacts {
  const row = sheet ?? {}

  const marital = typeof row.marital_status === 'string' ? row.marital_status.trim().toLowerCase() : ''
  // Substring, as `sheetIsMarried` in the root app does, so "remarried" counts.
  const married = marital ? marital.includes('married') && !marital.includes('never') : null

  const planType =
    typeof row.plan_type === 'string' && PLAN_TYPES.includes(row.plan_type.trim()) ? row.plan_type.trim() : null

  // `is_joint` defaults to false on a new sheet, so false is only an answer
  // once the sheet has been worked far enough to record a plan type.
  const jointPlan = row.is_joint === true ? true : row.is_joint === false && planType ? false : null

  // An empty list is the default, not "no children". Only a listed child can
  // prove there are, or are not, minors.
  const children = list(row.children)
  const hasMinorChildren = children.length === 0 ? null : children.some(child => child.is_minor === true)

  // Likewise for assets: with none listed nothing is known. Once the sheet
  // lists assets, a category none of them has counts as "no" — the reason a
  // business-succession rule can skip a matter with no business. That skip is
  // recorded on the run with its reason, never silent.
  const assets = list(row.assets)
  const hasCategory = (category: string) =>
    assets.length === 0 ? null : assets.some(asset => asset.category === category)

  let estateValue: MatterFacts['estimated_estate_value'] = null
  if (assets.length > 0) {
    let total = 0
    let complete = true
    for (const asset of assets) {
      if (typeof asset.estimated_value === 'number' && Number.isFinite(asset.estimated_value)) {
        total += asset.estimated_value
      } else {
        complete = false
      }
    }
    estateValue = { total, complete }
  }

  return {
    married,
    joint_plan: jointPlan,
    has_minor_children: hasMinorChildren,
    has_business_interest: hasCategory('business'),
    owns_real_property: hasCategory('real_property'),
    plan_type: planType,
    estimated_estate_value: estateValue,
  }
}

/**
 * Reads facts back from a run's `resolved_inputs`. Anything that does not look
 * like facts is treated as none — every rule runs — rather than as facts that
 * could skip one.
 */
export function parseMatterFacts(value: unknown): MatterFacts | null {
  if (typeof value !== 'object' || value === null) return null
  const facts = (value as Record<string, unknown>).matterFacts
  if (typeof facts !== 'object' || facts === null) return null
  const f = facts as Record<string, unknown>
  const bool = (v: unknown) => (typeof v === 'boolean' ? v : null)
  const estate = f.estimated_estate_value as Record<string, unknown> | null | undefined
  return {
    married: bool(f.married),
    joint_plan: bool(f.joint_plan),
    has_minor_children: bool(f.has_minor_children),
    has_business_interest: bool(f.has_business_interest),
    owns_real_property: bool(f.owns_real_property),
    plan_type: typeof f.plan_type === 'string' ? f.plan_type : null,
    estimated_estate_value:
      estate && typeof estate.total === 'number' && typeof estate.complete === 'boolean'
        ? { total: estate.total, complete: estate.complete }
        : null,
  }
}

type Truth = true | false | null

function test(condition: RuleCondition, facts: MatterFacts): Truth {
  switch (condition.test) {
    case 'is': {
      const value = facts[condition.fact] as boolean | null
      return value === null ? null : value === condition.value
    }
    case 'one_of': {
      const value = facts[condition.fact] as string | null
      return value === null ? null : condition.value.includes(value)
    }
    case 'at_least': {
      const estate = facts[condition.fact] as MatterFacts['estimated_estate_value']
      if (!estate) return null
      if (estate.total >= condition.value) return true
      return estate.complete ? false : null
    }
  }
}

/** Massachusetts estate tax exemption, from 2023. */
export const MA_ESTATE_TAX_THRESHOLD = 2_000_000

/**
 * The words the model may use for "this position applies only when…", each
 * mapped to exactly one condition. A closed vocabulary rather than the
 * condition schema itself, so a suggestion can never name a fact that does
 * not exist or test one the wrong way.
 */
export const APPLIES_WHEN: Record<string, RuleCondition> = {
  married: { fact: 'married', test: 'is', value: true },
  not_married: { fact: 'married', test: 'is', value: false },
  joint_plan: { fact: 'joint_plan', test: 'is', value: true },
  individual_plan: { fact: 'joint_plan', test: 'is', value: false },
  has_minor_children: { fact: 'has_minor_children', test: 'is', value: true },
  has_business_interest: { fact: 'has_business_interest', test: 'is', value: true },
  owns_real_property: { fact: 'owns_real_property', test: 'is', value: true },
  pour_over_plan: { fact: 'plan_type', test: 'one_of', value: ['pour_over'] },
  testamentary_trust_plan: { fact: 'plan_type', test: 'one_of', value: ['testamentary_trust'] },
  trust_based_plan: { fact: 'plan_type', test: 'one_of', value: ['pour_over', 'testamentary_trust'] },
  estate_over_ma_exemption: { fact: 'estimated_estate_value', test: 'at_least', value: MA_ESTATE_TAX_THRESHOLD },
}

/** How each `APPLIES_WHEN` word reads to an attorney picking one. */
export const APPLIES_WHEN_LABELS: Record<keyof typeof APPLIES_WHEN & string, string> = {
  married: 'Client is married',
  not_married: 'Client is not married',
  joint_plan: 'Joint plan for a couple',
  individual_plan: 'Individual (not joint) plan',
  has_minor_children: 'Has minor children',
  has_business_interest: 'Owns a business interest',
  owns_real_property: 'Owns real estate',
  pour_over_plan: 'Pour-over will + revocable trust',
  testamentary_trust_plan: 'Will with testamentary trust',
  trust_based_plan: 'Any trust-based plan',
  estate_over_ma_exemption: 'Estate at or above the MA exemption ($2M)',
}

const money = (n: number) => `$${n.toLocaleString('en-US')}`

export function describeCondition(condition: RuleCondition): string {
  const fact = MATTER_FACTS[condition.fact]
  switch (condition.test) {
    case 'is':
      return condition.value ? fact.label.toLowerCase() : `not: ${fact.label.toLowerCase()}`
    case 'one_of': {
      const options = 'options' in fact ? fact.options : []
      const labels = condition.value.map(v => options.find(o => o.value === v)?.label ?? v)
      return `${fact.label.toLowerCase()} is ${labels.join(' or ')}`
    }
    case 'at_least':
      return `${fact.label.toLowerCase()} is at least ${money(condition.value)}`
  }
}

export type ConditionEvaluation =
  | { status: 'applies' }
  | { status: 'not_met'; condition: RuleCondition; reason: string }
  /** Some fact is not recorded and none is definitely false: the rule runs. */
  | { status: 'unknown'; unknown: RuleCondition[] }

/** All conditions must hold. No conditions, or no facts at all, means the rule applies. */
export function evaluateConditions(
  conditions: RuleCondition[] | undefined,
  facts: MatterFacts | null,
): ConditionEvaluation {
  if (!conditions || conditions.length === 0 || !facts) return { status: 'applies' }
  const unknown: RuleCondition[] = []
  for (const condition of conditions) {
    const result = test(condition, facts)
    if (result === false) {
      return {
        status: 'not_met',
        condition,
        reason: `Not checked: this rule applies only when ${describeCondition(condition)}, and the design sheet says otherwise.`,
      }
    }
    if (result === null) unknown.push(condition)
  }
  return unknown.length > 0 ? { status: 'unknown', unknown } : { status: 'applies' }
}
