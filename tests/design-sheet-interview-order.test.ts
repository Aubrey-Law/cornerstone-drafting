import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildDesignSheetGroups } from '@/app/admin/drafting/[matterId]/design/designSectionCatalog'
import type { DesignDocumentInclusions } from '@/lib/designSheetDocumentInclusions'

const inclusions = (patch: Partial<DesignDocumentInclusions> = {}): DesignDocumentInclusions => ({
  trust: true,
  will: true,
  dpoa: true,
  healthcare: true,
  deed: true,
  young_adult_estate_plan: false,
  ferpa_release: false,
  education_poa: false,
  spouse_docs: false,
  ...patch,
})

const FULL_SHEET_ORDER = [
  'facts',
  'fiduciaries',
  'plan',
  'trust',
  'powers-of-attorney',
  'healthcare',
  'real-property',
  'asset-schedules',
  'trust-provisions',
  'family',
  'notes',
]

describe('full design sheet interview order', () => {
  it('walks facts, fiduciaries, plan, then each document, with provisions after those decisions', () => {
    expect(buildDesignSheetGroups([], 'estate', 'full').map(group => group.id)).toEqual(FULL_SHEET_ORDER)
    expect(buildDesignSheetGroups([], 'estate', 'full', inclusions()).map(group => group.id)).toEqual(FULL_SHEET_ORDER)
  })

  it('hides deed and trust groups when those documents are off and keeps the plan group', () => {
    const ids = buildDesignSheetGroups([], 'estate', 'full', inclusions({
      trust: false,
      deed: false,
    })).map(group => group.id)

    expect(ids).toEqual([
      'facts',
      'fiduciaries',
      'plan',
      'powers-of-attorney',
      'healthcare',
      'family',
      'notes',
    ])
  })

  it('shows real property again when a deed document is on', () => {
    const ids = buildDesignSheetGroups([], 'estate', 'full', inclusions({
      trust: false,
      deed: true,
    })).map(group => group.id)

    expect(ids).toContain('plan')
    expect(ids).toContain('real-property')
    expect(ids).not.toContain('asset-schedules')
    expect(ids).not.toContain('trust')
    expect(ids).not.toContain('trust-provisions')
  })

  it('leaves college-prep groups unchanged when inclusions are omitted', () => {
    expect(buildDesignSheetGroups([], 'college_prep').map(group => group.id)).toEqual([
      'facts',
      'college-plan',
      'fiduciaries',
      'powers-of-attorney',
      'healthcare',
      'notes',
    ])
  })

  it('keeps the essential sheet on its three groups when inclusions are passed', () => {
    expect(buildDesignSheetGroups([], 'estate', 'essential', inclusions({ trust: false, deed: false })).map(group => group.id))
      .toEqual(['facts', 'fiduciaries', 'essential-plan'])
  })

  it('splits trust into a plan pass and a provisions pass', () => {
    const catalog = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/designSectionCatalog.tsx'),
      'utf8',
    )
    const trust = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/TrustDetailsSection.tsx'),
      'utf8',
    )

    expect(catalog).toContain("title: 'Asset schedules'")
    const plan = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections/PlanDesignSection.tsx'),
      'utf8',
    )
    expect(plan).toContain('<PlanStructureFactsSection sheet={sheet} onChange={onChange} includeAssets={false} />')
    expect(catalog).toContain('<TrustDetailsSection {...docCommon} variant="plan" />')
    expect(catalog).toContain('<TrustDetailsSection {...docCommon} variant="provisions" />')
    expect(trust).toContain("essential ? 'Joint Trust' : 'Trust Structure'")
    expect(trust).toContain('{!essential && (')
    expect(trust).toContain('{!provisionsOnly && (')
    expect(trust).toContain('remoteBeneficiariesOnly')
    expect(trust).toContain('(!provisionsOnly || !essential)')
  })
})
