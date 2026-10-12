import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DESIGN_SHEET_GROUP_IDS,
  DESIGN_SECTION_IDS,
  designSectionAnchorId,
} from '@/lib/designSheet/sectionIds'

const pageSource = fs.readFileSync(
  path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/DesignSheetPage.tsx'),
  'utf8',
)

describe('sectioned design sheet anchors', () => {
  it('maps legacy section navigation onto the stable group anchors', () => {
    // Ten estate groups, the college-prep group, and the essential-plan group.
    expect(Object.keys(DESIGN_SHEET_GROUP_IDS)).toHaveLength(12)
    expect(DESIGN_SHEET_GROUP_IDS.essentialPlan).toBe('essential-plan')
    expect(designSectionAnchorId(DESIGN_SECTION_IDS.trustDetails)).toBe('trust')
    expect(designSectionAnchorId('trust')).toBe('trust')
    expect(designSectionAnchorId(DESIGN_SECTION_IDS.clientInformation)).toBe('facts')
    expect(designSectionAnchorId(DESIGN_SECTION_IDS.financialPoa)).toBe('powers-of-attorney')
    expect(designSectionAnchorId(DESIGN_SECTION_IDS.collegePlan)).toBe('college-plan')
  })

  it('renders one section at a time instead of a single scroll page', () => {
    // Only the active group mounts; the review section is the synthetic last stop.
    expect(pageSource).toContain('{activeGroup.render()}')
    expect(pageSource).not.toContain('{groups.map(group => {')
    expect(pageSource).toContain('REVIEW_GROUP')
    expect(pageSource).toContain('SigningMechanicsSection')
    expect(pageSource).toContain('DesignFinalReview')
  })

  it('keeps focus and field targeting inside the page container', () => {
    expect(pageSource).toContain('container.scrollTop +=')
    expect(pageSource).toContain("target.focus({ preventScroll: true })")
    expect(pageSource).toContain('}, 1600)')
    expect(pageSource).not.toContain('scrollIntoView')
  })

  it('removes the legacy per-section route after the cleanup phase', () => {
    expect(fs.existsSync(
      path.join(process.cwd(), 'app/admin/drafting/[matterId]/design/[sectionId]/page.tsx'),
    )).toBe(false)
  })
})
