import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  designPlanTypeIncludesTrust,
  designPlanTypeLabel,
  normalizeDesignPlanType,
} from '@/lib/designPlanType'

describe('design plan type normalization', () => {
  it('accepts only template-aligned plan types', () => {
    expect(normalizeDesignPlanType('pour_over')).toBe('pour_over')
    expect(normalizeDesignPlanType('outright_will')).toBe('outright_will')
    expect(normalizeDesignPlanType('testamentary_trust')).toBe('testamentary_trust')
  })

  it('does not silently map retired design-sheet plan type aliases', () => {
    expect(normalizeDesignPlanType('individual_trust')).toBeNull()
    expect(normalizeDesignPlanType('joint_trust')).toBeNull()
    expect(normalizeDesignPlanType('will_based_plan')).toBeNull()
    expect(normalizeDesignPlanType('married_simple')).toBeNull()
    expect(normalizeDesignPlanType('married_disclaimer')).toBeNull()
    expect(normalizeDesignPlanType('married_clayton')).toBeNull()
    expect(normalizeDesignPlanType('revocable_trust')).toBeNull()
    expect(normalizeDesignPlanType('Joint Trust')).toBeNull()
    expect(normalizeDesignPlanType('Will-Based Plan')).toBeNull()
  })

  it('uses canonical values for labels and trust inclusion', () => {
    expect(designPlanTypeLabel('pour_over')).toBe('Pour-Over Will + Revocable Trust')
    expect(designPlanTypeLabel('outright_will')).toContain('Outright Distributions')
    expect(designPlanTypeIncludesTrust('pour_over')).toBe(true)
    expect(designPlanTypeIncludesTrust('testamentary_trust')).toBe(true)
    expect(designPlanTypeIncludesTrust('outright_will')).toBe(false)
    expect(designPlanTypeIncludesTrust('joint_trust')).toBe(false)
  })
})

describe('legacy design-sheet plan type migration', () => {
  it('canonicalizes stale stored design-sheet plan type values', () => {
    const migrationsDir = path.join(process.cwd(), 'supabase/migrations_archive/portal')
    const migration = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .map(file => fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
      .find(source => source.includes('revocable_trust') && source.includes("plan_type = 'pour_over'"))

    expect(migration).toBeDefined()
    expect(migration).toContain('public.design_sheets')
    expect(migration).toContain("'individual_trust'")
    expect(migration).toContain("'joint_trust'")
    expect(migration).toContain("'will_based_plan'")
    expect(migration).toContain("'revocable_trust'")
    expect(migration).toContain("plan_type = 'outright_will'")
  })
})

describe('drafting prompt plan type label', () => {
  it('does not fall back to retired plan type wording', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'app/api/drafting/route.ts'),
      'utf8',
    )

    expect(source).toContain("designPlanTypeLabel(designSheet.plan_type) || 'Unspecified'")
    expect(source).not.toContain("|| 'Individual Trust'")
  })
})
