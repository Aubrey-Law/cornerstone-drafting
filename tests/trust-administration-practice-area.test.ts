import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PRACTICE_AREA_OPTIONS,
  isFiduciaryPracticeArea,
  isTrustAdministrationPracticeArea,
  normalizePracticeArea,
  parsePracticeArea,
  practiceAreaLabel,
  practiceAreaMatterCode,
} from '@/lib/practiceArea'
import { formatMatterNumber } from '@/lib/matterNumber'
import { ESTATE_PLANNING_SLA_V3, PROBATE_SLA_V1, slaTemplateForPracticeArea } from '@/lib/slaTasks/generate'
import { isEstatePlanningPracticeArea } from '@/lib/draftPayload/helpers'

/**
 * Trust Administration is a practice area of its own. The risk in adding one is
 * not the new code but the old fallbacks: an area the app does not recognise
 * becomes Estate Planning, and an estate matter gets the 48-task checklist, the
 * drafting workspace and an estate fee package. These pin that TA is
 * recognised everywhere a practice area decides something, and that the SQL
 * functions restated for it are the live ones with only the TA branch added.
 */

const root = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')
const MIGRATION = read('supabase/migrations/20270127090000_trust_administration_practice_area.sql')

describe('the code', () => {
  it('is offered, parsed from the ways it is written, and numbered TA', () => {
    expect(PRACTICE_AREA_OPTIONS.find(option => option.value === 'TA')?.label).toBe('Trust Administration')
    for (const written of ['TA', 'ta', 'Trust Administration', 'TRUST ADMINISTRATION', 'Trust Admin']) {
      expect(parsePracticeArea(written), written).toBe('TA')
    }
    expect(normalizePracticeArea('TA')).toBe('TA')
    expect(practiceAreaLabel('TA')).toBe('Trust Administration')
    expect(practiceAreaMatterCode('TA')).toBe('TA')
    expect(formatMatterNumber(2027, practiceAreaMatterCode('TA'), 4)).toBe('2027-TA-004')
  })

  it('is fiduciary work, not estate planning', () => {
    expect(isTrustAdministrationPracticeArea('Trust Administration')).toBe(true)
    expect(isFiduciaryPracticeArea('TA')).toBe(true)
    expect(isFiduciaryPracticeArea('Probate')).toBe(true)
    expect(isFiduciaryPracticeArea('EP')).toBe(false)
    expect(isEstatePlanningPracticeArea('TA')).toBe(false)
  })
})

describe('never the estate path', () => {
  it('gets no checklist rather than the estate one', () => {
    expect(slaTemplateForPracticeArea('TA')).toBeNull()
    expect(slaTemplateForPracticeArea('EP')).toBe(ESTATE_PLANNING_SLA_V3)
    expect(slaTemplateForPracticeArea('Probate')).toBe(PROBATE_SLA_V1)
    // The lead path no longer falls back to the estate checklist when there is none.
    const generate = read('lib/slaTasks/generate.ts')
    expect(generate).not.toContain('slaTemplateForPracticeArea(options.practiceArea) ?? ESTATE_PLANNING_SLA_V3')
  })

  it('is kept out of the drafting workspace and the Statular package', () => {
    expect(read('app/admin/drafting/[matterId]/loadDraftingMatterContext.ts')).toContain("normalizedPracticeArea === 'Probate' || normalizedPracticeArea === 'TA'")
    expect(read('lib/integrations/statular/packageKey.ts')).toContain("if (area === 'Probate' || area === 'TA') throw configurationRequired()")
  })

  it('can be chosen on a lead', () => {
    expect(read('lib/leads/details.ts')).toContain("z.enum(['EP', 'EP-LP', 'Probate', 'TA']")
    expect(read('lib/adminChat/leadTools.ts')).toContain("enum: ['EP', 'EP-LP', 'Probate', 'TA']")
  })

  it('keeps the books in the trust ledger', () => {
    const detail = read('app/admin/matters/[id]/MatterDetailClient.tsx')
    expect(detail).toContain("const showFiduciaryLedger = practiceArea === 'Probate' || practiceArea === 'TA'")
    expect(detail).toContain("trust={practiceArea === 'TA'}")
  })
})

describe('the migration', () => {
  it('widens the CHECK constraint', () => {
    expect(MIGRATION).toContain("CHECK (practice_area IS NULL OR practice_area IN ('EP', 'EP-LP', 'CP', 'Probate', 'TA'))")
  })

  it('bills a signed TA engagement as a plain flat fee, never an estate package', () => {
    expect(MIGRATION).toContain("when upper(coalesce(new.practice_area, '')) in ('TA', 'TRUST ADMINISTRATION') then 'TA'")
    expect(MIGRATION).toContain("if coalesce(v_enabled, false) and v_area not in ('Probate', 'TA') then")
  })

  it('changes no existing row', () => {
    // Function bodies write rows when they run; the migration itself must not.
    const statements = MIGRATION.replace(/\$\$[\s\S]*?\$\$/g, '')
    expect(statements).not.toMatch(/\b(update|insert\s+into|delete\s+from)\s+(public\.)?\w+/i)
  })

  /**
   * The four functions are restated whole. Strip the lines this migration adds
   * and the two it edits, and what is left must be the live definition byte for
   * byte, so nothing else in those long functions changed by accident.
   */
  it('restates each function verbatim apart from the TA branch', () => {
    const fn = (sql: string, name: string, end: string) => {
      const start = sql.indexOf(`create or replace function public.${name}`)
      expect(start, name).toBeGreaterThanOrEqual(0)
      return sql.slice(start, sql.indexOf(end, start) + end.length)
    }
    const withoutTa = (body: string) => body
      .split('\n')
      .filter(line => !/'TA'/.test(line) || /v_text not in|v_area not in/.test(line))
      .filter(line => !/^\s+new\.practice_area := 'TA';$/.test(line))
      .join('\n')
      .replace("v_text not in ('EP', 'EP-LP', 'CP', 'Probate', 'TA')", "v_text not in ('EP', 'EP-LP', 'CP', 'Probate')")
      .replace("v_area not in ('Probate', 'TA')", "v_area <> 'Probate'")
    const collegePrep = read('supabase/migrations/20260921000000_college_prep_practice_area.sql')
    const payor = read('supabase/migrations/20261214000000_engagement_seed_respects_payor.sql')
    for (const [name, live, end] of [
      ['normalize_shared_practice_area', collegePrep, '$$;'],
      ['update_lead_opportunity_field', collegePrep, '\n$$;'],
      ['convert_lead_to_matter', collegePrep, '\n$$;'],
      ['seed_engagement_billing_item', payor, 'end $$;'],
    ] as const) {
      expect(withoutTa(fn(MIGRATION, name, end)), name).toBe(fn(live, name, end))
    }
  })
})
