import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildDesignSheetGroups } from '@/app/admin/drafting/[matterId]/design/designSectionCatalog'
import { getAllDesignSectionNavItems } from '@/lib/designSheet/designSectionNav'
import { computeDesignSheetReadiness } from '@/lib/designSheetReadiness'
import { DESIGN_SECTION_IDS, DESIGN_SHEET_GROUP_IDS } from '@/lib/designSheet/sectionIds'
import {
  ESSENTIAL_DESIGN_SHEET_TITLE,
  resolveDesignSheetLayout,
  setDesignSheetLayout,
} from '@/lib/designSheet/sheetLayout'
import type { DesignSheet } from '@/types/database'

const sectionsDir = path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/sections')

function read(name: string) {
  return fs.readFileSync(path.join(sectionsDir, name), 'utf8')
}

describe('essential design sheet layout', () => {
  it('opens Essential Estate Plan Design for EP and EPLP matters', () => {
    expect(resolveDesignSheetLayout({ practiceArea: 'EP', sheet: null })).toBe('essential')
    expect(resolveDesignSheetLayout({ practiceArea: 'EP-LP', sheet: null })).toBe('essential')
    expect(resolveDesignSheetLayout({ practiceArea: 'Estate Planning', sheet: null })).toBe('essential')
    expect(ESSENTIAL_DESIGN_SHEET_TITLE).toBe('Essential Estate Plan Design')
  })

  it('keeps the full sheet for other practice areas and for an explicit choice', () => {
    expect(resolveDesignSheetLayout({ practiceArea: 'CP', sheet: null })).toBe('college_prep')
    expect(resolveDesignSheetLayout({ practiceArea: 'Probate', sheet: null })).toBe('full')
    expect(resolveDesignSheetLayout({ practiceArea: 'TA', sheet: null })).toBe('full')
    expect(resolveDesignSheetLayout({ practiceArea: null, sheet: null })).toBe('full')

    const full = setDesignSheetLayout({ decisions: {} }, 'full')
    expect(resolveDesignSheetLayout({ practiceArea: 'EP', sheet: { decisions: full } })).toBe('full')
    const essential = setDesignSheetLayout({ decisions: full }, 'essential')
    expect(resolveDesignSheetLayout({ practiceArea: 'EP-LP', sheet: { decisions: essential } })).toBe('essential')
  })

  it('limits the essential sheet to Intake Details, Fiduciaries, and Estate Plan Design', () => {
    const ids = getAllDesignSectionNavItems({
      intakeSnapshot: null,
      documentInclusions: {
        trust: true,
        will: true,
        dpoa: true,
        healthcare: true,
        deed: true,
        young_adult_estate_plan: false,
        ferpa_release: false,
        education_poa: false,
        spouse_docs: false,
      },
      layout: 'essential',
    }).map(item => item.id)

    expect(ids).toEqual([
      DESIGN_SECTION_IDS.clientInformation,
      DESIGN_SECTION_IDS.fiduciaries,
      DESIGN_SECTION_IDS.essentialEstatePlan,
    ])

    expect(buildDesignSheetGroups([], 'estate', 'essential').map(group => ({
      id: group.id,
      title: group.title,
    }))).toEqual([
      { id: DESIGN_SHEET_GROUP_IDS.facts, title: 'Intake Details' },
      { id: DESIGN_SHEET_GROUP_IDS.fiduciaries, title: 'Fiduciaries' },
      { id: DESIGN_SHEET_GROUP_IDS.essentialPlan, title: 'Estate Plan Design' },
    ])
  })

  it('leaves the full estate section list in place', () => {
    const ids = getAllDesignSectionNavItems({
      intakeSnapshot: null,
      documentInclusions: {
        trust: true,
        will: true,
        dpoa: true,
        healthcare: true,
        deed: false,
        young_adult_estate_plan: false,
        ferpa_release: false,
        education_poa: false,
        spouse_docs: false,
      },
      planType: 'pour_over',
      layout: 'full',
    }).map(item => item.id)

    expect(ids).toContain(DESIGN_SECTION_IDS.trustDetails)
    expect(ids).toContain(DESIGN_SECTION_IDS.financialPoa)
    expect(ids).not.toContain(DESIGN_SECTION_IDS.essentialEstatePlan)
  })
})

describe('essential estate plan design section', () => {
  const essential = read('EssentialEstatePlanDesignSection.tsx')

  it('pulls the requested blocks from the full design sheet', () => {
    expect(essential).toContain('<PlanTypeBlock')
    expect(essential).toContain('title="Asset Transfer Documents"')
    expect(essential).toContain('<PlanStructureFactsSection')
    expect(essential).toContain('includeAssets={false}')
    expect(essential).toContain('title="Trust"')
    expect(essential).toContain('variant="essential"')
    expect(essential).toContain('title="Power of Attorney"')
    expect(essential).toContain('onlyCoagent')
    expect(essential).toContain('title="Health care"')
    expect(essential).toContain('scope="essential"')
    expect(essential).toContain('title="Real property"')
    expect(essential).toContain('title="Signing Type"')
  })

  it('keeps the trust subsections the essential sheet asks for', () => {
    const trust = read('TrustDetailsSection.tsx')
    expect(trust).toContain("essential ? 'Joint Trust' : 'Trust Structure'")
    expect(trust).toContain('title="Trust Name"')
    expect(trust).toContain('specificBequestsOnly')
    expect(trust).toContain('title="Pet Care Provisions"')
    expect(trust).toContain('question="Residual beneficiary"')
    expect(trust).toContain('question="Residual Beneficiary Method"')
    expect(trust).toContain('remoteBeneficiariesOnly')
    expect(trust).toContain('{!essential && (')
  })
})

describe('essential readiness', () => {
  const sheet = {
    plan_type: 'pour_over',
    marital_status: 'married',
    matter_type: 'couple',
    decisions: {},
    children: [],
    is_joint: true,
    client_name: 'Jane Doe',
    client_dob: '1980-01-01',
    client_email: 'jane@example.com',
    state: 'MA',
    spouse_name: 'John Doe',
    trust_name: 'The Doe Trust',
  } as unknown as DesignSheet

  const args = {
    sheet,
    matter: { has_minor_children: false },
    isLP: true,
    lpData: { li_design_sheet_data: {} },
  }

  it('does not block on decisions the essential sheet does not show', () => {
    const essential = computeDesignSheetReadiness({ ...args, layout: 'essential' })
    const full = computeDesignSheetReadiness({ ...args, layout: 'full' })
    const essentialLabels = essential.blocking.map(item => item.label)
    const fullLabels = full.blocking.map(item => item.label)

    expect(fullLabels).toEqual(expect.arrayContaining([
      'basic attorney-in-fact powers',
      'advance health directive',
      'if spouse survives',
    ]))
    expect(essentialLabels).not.toContain('basic attorney-in-fact powers')
    expect(essentialLabels).not.toContain('advance health directive')
    expect(essentialLabels).not.toContain('if spouse survives')
    expect(essentialLabels).toContain('distribution method')
    expect(essentialLabels).toContain('anatomical gift election')
  })
})
