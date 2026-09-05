import { describe, expect, it } from 'vitest'
import {
  ASSET_CATEGORIES,
  FUNDING_METHODS,
  FUNDING_STATUSES,
  categoryLabel,
  defaultMethodFor,
  fundingSummary,
  isFunded,
  methodIsPermitted,
  permittedMethodsFor,
  type FundableAsset,
} from '@/lib/funding/model'

const asset = (over: Partial<FundableAsset> = {}): FundableAsset => ({
  value: 100_000,
  status: 'not_started',
  category: 'bank',
  ...over,
})

describe('asset categories', () => {
  /**
   * These are the values the intake form actually writes, read off the live
   * table rather than assumed. The old app's funding-plan map still says
   * `real_property` and `financial`, which match nothing, so every real-estate
   * and bank asset there labels itself "Other".
   */
  it('covers every category the intake form writes', () => {
    for (const category of ['bank', 'business', 'crypto', 'inheritance', 'investment',
      'life_insurance', 'other', 'real_estate', 'retirement', 'vehicles']) {
      expect(ASSET_CATEGORIES).toContain(category)
    }
  })

  it('labels each one in the words an attorney uses', () => {
    expect(categoryLabel('real_estate')).toBe('Real estate')
    expect(categoryLabel('retirement')).toBe('Retirement account')
    expect(categoryLabel('life_insurance')).toBe('Life insurance')
  })

  it('does not silently label an unknown category as something it is not', () => {
    expect(categoryLabel('sculpture_collection')).toBe('sculpture_collection')
  })
})

describe('defaultMethodFor', () => {
  it.each([
    ['real_estate', 'deed'],
    ['bank', 'retitle'],
    ['investment', 'retitle'],
    ['business', 'assignment'],
    ['retirement', 'beneficiary'],
    ['life_insurance', 'beneficiary'],
  ])('%s is funded by %s', (category, method) => {
    expect(defaultMethodFor(category)).toBe(method)
  })

  /**
   * Undecided rather than guessed. A vehicle is rarely retitled into a
   * revocable trust in Massachusetts, an inheritance may be a mere expectancy
   * with nothing to transfer yet, and "other" is by definition unknown. A
   * wrong default here reads as advice.
   */
  it.each(['vehicles', 'inheritance', 'crypto', 'other', 'sculpture_collection'])(
    'leaves %s for the attorney to decide',
    (category) => {
      expect(defaultMethodFor(category)).toBe('undecided')
    },
  )
})

describe('methodIsPermitted', () => {
  /**
   * The rule this whole module exists to encode.
   *
   * Retitling an IRA or a 401(k) into a revocable trust is not a transfer, it
   * is a distribution: the entire account becomes taxable income in that year.
   * The account is connected to the plan by beneficiary designation instead.
   * A tracker that let someone tick "retitled" against a retirement account
   * would be recording the single most expensive mistake in estate funding as
   * though it were progress.
   */
  it.each(['deed', 'retitle'])('refuses to record a retirement account as %s', (method) => {
    expect(methodIsPermitted('retirement', method as never)).toBe(false)
  })

  it('allows a retirement account to be handled by beneficiary designation', () => {
    expect(methodIsPermitted('retirement', 'beneficiary')).toBe(true)
  })

  it('allows a retirement account to be excluded deliberately', () => {
    expect(methodIsPermitted('retirement', 'none_required')).toBe(true)
  })

  /**
   * Life insurance is not forbidden from an ownership transfer: assigning a
   * policy is real practice, though it belongs to an irrevocable trust rather
   * than this one. Only what is unambiguously wrong is refused.
   */
  it('permits an ownership transfer of life insurance', () => {
    expect(methodIsPermitted('life_insurance', 'retitle')).toBe(true)
  })

  it('permits anything for a category with no rule against it', () => {
    for (const method of FUNDING_METHODS) {
      expect(methodIsPermitted('other', method)).toBe(true)
    }
  })

  it('offers only permitted methods for a category', () => {
    expect(permittedMethodsFor('retirement')).not.toContain('retitle')
    expect(permittedMethodsFor('retirement')).toContain('beneficiary')
    expect(permittedMethodsFor('real_estate')).toContain('deed')
  })
})

describe('isFunded', () => {
  it('counts only a confirmed asset as funded', () => {
    expect(isFunded('confirmed')).toBe(true)
  })

  /**
   * Awaiting confirmation is not funded. The paperwork being sent is exactly
   * the state in which people assume a trust is funded and it is not — the
   * institution can reject it, and nobody finds out until someone dies.
   */
  it.each(['not_started', 'in_progress', 'awaiting_confirmation'])('does not count %s', (status) => {
    expect(isFunded(status as never)).toBe(false)
  })

  it('treats a deliberately excluded asset as needing nothing', () => {
    expect(isFunded('not_applicable')).toBe(true)
  })
})

describe('fundingSummary', () => {
  it('reports the value still outside the plan', () => {
    const summary = fundingSummary([
      asset({ value: 500_000, status: 'not_started' }),
      asset({ value: 250_000, status: 'awaiting_confirmation' }),
      asset({ value: 900_000, status: 'confirmed' }),
    ])
    // The figure that makes a client act.
    expect(summary.unfundedValue).toBe(750_000)
    expect(summary.fundedValue).toBe(900_000)
    expect(summary.unfundedCount).toBe(2)
  })

  it('leaves a deliberately excluded asset out of the unfunded figure', () => {
    const summary = fundingSummary([
      asset({ value: 40_000, status: 'not_applicable' }),
      asset({ value: 10_000, status: 'not_started' }),
    ])
    expect(summary.unfundedValue).toBe(10_000)
  })

  it('is zero for a matter with nothing recorded', () => {
    expect(fundingSummary([])).toMatchObject({ unfundedValue: 0, fundedValue: 0, unfundedCount: 0, total: 0 })
  })

  it('reports completeness so a matter can be seen as done at a glance', () => {
    expect(fundingSummary([asset({ status: 'confirmed' }), asset({ status: 'confirmed' })]).isComplete).toBe(true)
    expect(fundingSummary([asset({ status: 'confirmed' }), asset({ status: 'not_started' })]).isComplete).toBe(false)
  })

  it('is not complete when there is nothing to fund, because nothing was reviewed', () => {
    // An empty asset list means intake captured none, not that funding is done.
    expect(fundingSummary([]).isComplete).toBe(false)
  })

  it('handles a value that arrives as a numeric string from Postgres', () => {
    // `numeric` comes back as a string through PostgREST often enough to matter.
    const summary = fundingSummary([{ value: '1250.50' as never, status: 'not_started', category: 'bank' }])
    expect(summary.unfundedValue).toBe(1250.5)
  })

  it('ignores a value that is not a number rather than producing NaN', () => {
    const summary = fundingSummary([
      { value: null as never, status: 'not_started', category: 'bank' },
      asset({ value: 100, status: 'not_started' }),
    ])
    expect(summary.unfundedValue).toBe(100)
  })
})

describe('the status and method vocabularies', () => {
  it('are ordered as the work progresses', () => {
    expect(FUNDING_STATUSES).toEqual([
      'not_started',
      'in_progress',
      'awaiting_confirmation',
      'confirmed',
      'not_applicable',
    ])
  })

  it('name every method the tracker can record', () => {
    expect(FUNDING_METHODS).toEqual([
      'undecided',
      'deed',
      'retitle',
      'beneficiary',
      'assignment',
      'none_required',
    ])
  })
})
