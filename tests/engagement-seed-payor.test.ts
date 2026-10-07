import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { MATTER_BILLING_TYPES, isLegalPlanBilling } from '@/lib/billing/billingType'

function migration(suffix: string): string {
  const dir = path.join(process.cwd(), 'supabase/migrations')
  const filename = fs.readdirSync(dir).find(name => name.endsWith(suffix))
  if (!filename) throw new Error(`migration ${suffix} not found`)
  return fs.readFileSync(path.join(dir, filename), 'utf8')
}

const payorMigration = () => migration('_engagement_seed_respects_payor.sql')

/**
 * The executable SQL with `--` comments stripped. The migration's header
 * discusses the old inline list by name, so a naive substring check over the
 * whole file would match the explanation rather than any surviving code.
 */
function payorMigrationCode(): string {
  return payorMigration()
    .split('\n')
    .map(line => line.replace(/--.*$/, ''))
    .join('\n')
}

/**
 * The SQL predicate `is_legal_plan_billing` exists to say the same thing as
 * `isLegalPlanBilling`. The two have drifted apart once already — the old
 * inline list in the seeder omitted hyatt, legalshield and other_legal_plan,
 * and carried a 'legal_plan' entry that was never a member of the union — so
 * this file exists to fail loudly the next time someone adds a plan to the
 * TypeScript enum and forgets the database.
 */
function sqlPredicate(value: string | null): boolean {
  return value !== null && !['', 'flat_fee'].includes(value.trim().toLowerCase())
}

describe('payor predicate parity', () => {
  it.each(MATTER_BILLING_TYPES)('agrees for %s', billingType => {
    expect(sqlPredicate(billingType)).toBe(isLegalPlanBilling(billingType))
  })

  it('treats only flat_fee as direct-pay among the known types', () => {
    const carriers = MATTER_BILLING_TYPES.filter(type => sqlPredicate(type))
    expect(carriers).toEqual(['metlife', 'legalease', 'arag', 'clc', 'other_legal_plan'])
  })

  /**
   * An unclassified matter keeps seeding a client fee. Blocking on null would
   * stop legitimate seeding for every direct-pay matter nobody has classified,
   * which is a larger failure than the one being fixed.
   */
  it.each([null, '', '   '])('treats %o as direct-pay, not a carrier', value => {
    expect(sqlPredicate(value)).toBe(false)
    expect(isLegalPlanBilling(value)).toBe(false)
  })

  it('is case- and whitespace-insensitive, as the SQL lower(btrim(...)) is', () => {
    for (const value of ['LegalEASE', ' legalease ', 'MetLife']) {
      expect(sqlPredicate(value)).toBe(true)
    }
    for (const value of ['FLAT_FEE', ' flat_fee ']) {
      expect(sqlPredicate(value)).toBe(false)
    }
  })
})

describe('engagement seed migration', () => {
  it('defines the predicate as a mirror of the TypeScript one', () => {
    const sql = payorMigration()
    expect(sql).toContain('create or replace function public.is_legal_plan_billing(p_billing_type text)')
    expect(sql).toContain("not in ('', 'flat_fee')")
    expect(sql).toContain('immutable')
  })

  it('returns before seeding when a carrier is paying', () => {
    const sql = payorMigration()
    expect(sql).toContain('if public.is_legal_plan_billing(new.billing_type) then return new; end if;')
  })

  /**
   * 20260915000000 added this guard so a deleted engagement fee would not come
   * back; the 20261004000000 rewrite dropped it while delete_billing_items kept
   * writing the tombstone.
   */
  it('restores the deletion guard', () => {
    const sql = payorMigration()
    expect(sql).toContain('from public.billing_item_deletions d')
    expect(sql).toContain("d.source = 'engagement'")
  })

  it('carries no inline payor list that could drift from the predicate', () => {
    const code = payorMigrationCode()
    expect(code).not.toMatch(/not in \(\s*'metlife'/)
    // 'legal_plan' was never a member of MATTER_BILLING_TYPES; the old list
    // carried it as a dead entry.
    expect(code).not.toContain("'legal_plan'")
    // The predicate's own exclusion list is the one legitimate literal.
    expect(code).toContain("not in ('', 'flat_fee')")
  })

  it('leaves the rest of the seeding behaviour alone', () => {
    const sql = payorMigration()
    expect(sql).toContain("on conflict (matter_id) where source = 'engagement' do nothing")
    expect(sql).toContain("'item_seeded', 'Engagement fee added to billing'")
    expect(sql).toContain('round(new.flat_fee_amount * 100)::integer')
    expect(sql).toContain('perform public.create_matter_fee_schedule(')
    // The trigger still resolves the function by name, so recreating it would
    // be churn that risks dropping it on a partial apply.
    expect(sql).not.toContain('create trigger trg_seed_engagement_billing_item')
  })
})
