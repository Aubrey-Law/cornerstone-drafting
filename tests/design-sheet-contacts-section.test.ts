import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  getFiduciaryDocumentInclusions,
  setFiduciaryDocumentInclusion,
  setContactProfile,
  getContactProfiles,
} from '@/lib/designSheet/fiduciaryDocumentInclusions'
import { DESIGN_SECTION_IDS } from '@/lib/designSheet/sectionIds'
import { DESIGN_SECTION_LABELS } from '@/lib/designSheetReadiness'

const designRoot = path.join(process.cwd(), 'app/admin/drafting/[matterId]/design')

describe('fiduciary document inclusions', () => {
  it('defaults all inclusion flags to false', () => {
    expect(getFiduciaryDocumentInclusions({ decisions: {} })).toEqual({
      show_phone: false,
      show_address: false,
      show_email: false,
      show_dob: false,
      show_relationship: false,
    })
  })

  it('persists inclusion toggles in decisions', () => {
    const next = setFiduciaryDocumentInclusion({ decisions: {} }, 'show_phone', true)
    expect(getFiduciaryDocumentInclusions({ decisions: next })).toMatchObject({ show_phone: true })
  })

  it('stores contact profiles by contact id', () => {
    const decisions = setContactProfile({ decisions: {} }, 'c-1', {
      is_fiduciary: true,
      fiduciary_type: 'individual',
      relationship_detail: 'brother',
    })
    expect(getContactProfiles({ decisions })).toMatchObject({
      'c-1': {
        is_fiduciary: true,
        fiduciary_type: 'individual',
        relationship_detail: 'brother',
      },
    })
  })
})

describe('design sheet contacts UI cleanup', () => {
  it('removes plan coverage from Plan Design', () => {
    const source = fs.readFileSync(
      path.join(designRoot, 'sections/PlanDesignSection.tsx'),
      'utf8',
    )
    expect(source).not.toContain('Plan coverage')
    expect(source).not.toContain('onPlanCoverageChange')
  })

  it('removes separate spouse trust details section from nav and catalog', () => {
    const nav = fs.readFileSync(
      path.join(process.cwd(), 'lib/designSheet/designSectionNav.ts'),
      'utf8',
    )
    const catalog = fs.readFileSync(
      path.join(designRoot, 'designSectionCatalog.tsx'),
      'utf8',
    )
    expect(nav).not.toContain('trust-details-spouse')
    expect(catalog).not.toContain('TrustDetailsSpouseSection')
  })

  it('keeps spouse trustee slots on Trust Details for separate trusts', () => {
    const trustDetails = fs.readFileSync(
      path.join(designRoot, 'sections/TrustDetailsSection.tsx'),
      'utf8',
    )
    expect(trustDetails).toContain("scope=\"spouse\"")
    expect(trustDetails).toContain('spouse_trust_name')
  })

  it('uses the unified fiduciaries section and removes the superseded implementation', () => {
    const catalog = fs.readFileSync(
      path.join(designRoot, 'designSectionCatalog.tsx'),
      'utf8',
    )
    expect(catalog).toContain('DESIGN_SECTION_IDS.fiduciaries')
    expect(catalog).toContain('<FiduciariesSection')
    expect(catalog).not.toContain('<ContactsFiduciariesSection')
    expect(fs.existsSync(
      path.join(designRoot, 'sections/ContactsFiduciariesSection.tsx'),
    )).toBe(false)
  })

  it('registers contacts section in readiness labels', () => {
    expect(DESIGN_SECTION_LABELS[DESIGN_SECTION_IDS.contactsFiduciaries]).toBe('Contacts & Fiduciaries')
  })
})
