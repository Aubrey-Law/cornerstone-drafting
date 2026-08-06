import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  designTargetForMissingField,
  isKnownDesignSection,
  missingFieldDisplayLabel,
} from '@/lib/estateGenerator/missingFieldDesignMap'
import { DESIGN_SECTION_IDS } from '@/lib/designSheet/sectionIds'

function allRequiredFieldPaths(): string[] {
  const dir = path.join(process.cwd(), 'tools/aubreylaw-docgeneration/packages')
  const paths = new Set<string>()
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as { required_fields?: string[] }
    for (const p of pkg.required_fields ?? []) paths.add(p)
  }
  return [...paths]
}

describe('designTargetForMissingField', () => {
  it('resolves every package required-field path to a known design-sheet section', () => {
    const unresolved: string[] = []
    for (const fieldPath of allRequiredFieldPaths()) {
      const target = designTargetForMissingField(fieldPath)
      if (!isKnownDesignSection(target.sectionId)) unresolved.push(`${fieldPath} → ${target.sectionId}`)
    }
    expect(unresolved).toEqual([])
  })

  // Names are assigned in Fiduciary Role Assignment; Trust/Will Details only hold
  // that role's provisions. A link to the provisions section is a dead end.
  it('maps fiduciary and guardian names to the fiduciary role assignment section', () => {
    expect(designTargetForMissingField('fiduciaries.trustee.successor.full_name'))
      .toEqual({ path: 'fiduciaries.trustee.successor.full_name', label: 'Successor trustee', sectionId: DESIGN_SECTION_IDS.fiduciaries, sectionLabel: 'Fiduciary Role Assignment', targetField: null })
    expect(designTargetForMissingField('fiduciaries.executor.co_primary.full_name').sectionId)
      .toBe(DESIGN_SECTION_IDS.fiduciaries)
    expect(designTargetForMissingField('guardians.primary.full_name').sectionId)
      .toBe(DESIGN_SECTION_IDS.fiduciaries)
    expect(designTargetForMissingField('healthcare.agent.primary.full_name').sectionId)
      .toBe(DESIGN_SECTION_IDS.fiduciaries)
    expect(designTargetForMissingField('healthcare.agent.co_primary.full_name').sectionId)
      .toBe(DESIGN_SECTION_IDS.fiduciaries)
    expect(designTargetForMissingField('healthcare.agent.co_alternate.full_name').sectionId)
      .toBe(DESIGN_SECTION_IDS.fiduciaries)
  })

  it('keeps role provisions pointed at the section that holds them', () => {
    expect(designTargetForMissingField('fiduciaries.trustee.co_trustees_action').sectionId)
      .toBe(DESIGN_SECTION_IDS.trustDetails)
    expect(designTargetForMissingField('testamentary_trust.beneficiary_structure').sectionId)
      .toBe(DESIGN_SECTION_IDS.willDetails)
  })

  it('maps asset and homestead paths to the sections that collect them', () => {
    expect(designTargetForMissingField('assets.items').sectionId).toBe(DESIGN_SECTION_IDS.assetSchedules)
    expect(designTargetForMissingField('homestead.property_address_line').sectionId)
      .toBe(DESIGN_SECTION_IDS.transfersAssignments)
  })

  it('keeps the role in the label instead of collapsing every person to "Full Name"', () => {
    expect(designTargetForMissingField('fiduciaries.executor.co_primary.full_name').label)
      .toBe('Co-Executor / Co-Personal Representative')
    expect(designTargetForMissingField('healthcare.agent.co_primary.full_name').label)
      .toBe('Co-health care agent')
    expect(designTargetForMissingField('healthcare.agent.co_alternate.full_name').label)
      .toBe('Co alternate health care agent')
    expect(designTargetForMissingField('fiduciaries.brand_new_role.successor.full_name').label)
      .toBe('Brand New Role Successor')
  })

  it('names the person a companion package needs the field for', () => {
    expect(missingFieldDisplayLabel('Co-Personal Representative', 'client', null))
      .toBe('Co-Personal Representative')
    expect(missingFieldDisplayLabel('Co-Personal Representative', 'spouse', 'John Example'))
      .toBe("Co-Personal Representative — John Example's documents")
    expect(missingFieldDisplayLabel('Health care agent', 'young-adult', 'Alex Example'))
      .toBe("Health care agent — Alex Example's documents")
  })

  it('maps scalar client fields to a focusable personal-section input', () => {
    expect(designTargetForMissingField('client.county'))
      .toEqual({ path: 'client.county', label: 'County', sectionId: DESIGN_SECTION_IDS.clientInformation, sectionLabel: 'Client Information', targetField: 'county' })
  })

  it('degrades unknown paths to a section-level link without throwing', () => {
    const target = designTargetForMissingField('something.brand_new.field')
    expect(isKnownDesignSection(target.sectionId)).toBe(true)
    expect(target.targetField).toBeNull()
  })
})
